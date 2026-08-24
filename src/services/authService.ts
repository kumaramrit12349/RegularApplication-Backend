// src/services/authService.ts
import {
  AuthFlowType,
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  SignUpCommand,
  AdminGetUserCommand,
  ListUsersCommand,
  AdminDeleteUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { createThrowError, logErrorLocation } from "../utils/errorUtils";
import { RegisterRequest } from "../db_schema/Cognito/CongnitoInterface";
import { insertItemIntoDynamoDB } from "../dynamoDB_CRUD/insertData";
import { ALL_TABLE_NAMES, TABLE_PK_MAPPER } from "../db_schema/shared/SharedConstant";
import { IUser } from "../db_schema/User/UserInterface";
import { updateItemDynamoDB } from "../dynamoDB_CRUD/updateData";
import { fetchDynamoDB } from "../Interpreter/dynamoDB/fetchCalls";
import { UpdateUserAttributesCommand } from "@aws-sdk/client-cognito-identity-provider";
import https from "https";
import { COGNITO_CONFIG } from "../config/env";
import { TOPICS } from "../utils/topicUtils";

const cognito = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});

export async function checkCognitoForDuplicateEmail(email: string, checkingFor: "manual" | "google") {
  // Step 1: Fetch all Cognito users with this email.
  // This is isolated in its own try/catch so a Cognito API failure
  // fails-safe (blocks the request) instead of silently allowing a duplicate.
  let cognitoUsers: { UserStatus?: string; Username?: string }[] = [];
  try {
    const cmd = new ListUsersCommand({
      UserPoolId: COGNITO_CONFIG.userPoolId,
      Filter: `email = "${email}"`,
    });
    const res = await cognito.send(cmd);
    cognitoUsers = res.Users ?? [];
  } catch (err) {
    console.error("checkCognitoForDuplicateEmail - ListUsers failed:", err);
    // Fail-safe: if we can't verify uniqueness, block the request.
    createThrowError(500, "InternalServerError", "Unable to verify email availability. Please try again.", { email });
    return; // unreachable; satisfies TypeScript control flow
  }

  // Step 2: Check for conflicts.
  // createThrowError throws, so these run OUTSIDE of any try/catch
  // and propagate directly to the caller.
  if (cognitoUsers.length > 0) {
    let manualUserExists = false;
    let googleUserExists = false;
    let googleUsername = "";

    for (const user of cognitoUsers) {
      if (user.UserStatus === "EXTERNAL_PROVIDER") {
        googleUserExists = true;
        googleUsername = user.Username || "";
      } else {
        manualUserExists = true;
      }
    }

    if (checkingFor === "manual" && googleUserExists) {
      createThrowError(400, "Conflict", "Email already exists. Try signing in with Google.", { email });
    }

    if (checkingFor === "google" && manualUserExists) {
      // Cognito provisions the EXTERNAL_PROVIDER user before our callback runs.
      // Delete the phantom Google user so it doesn't linger in the pool.
      if (googleUserExists && googleUsername) {
        try {
          await cognito.send(new AdminDeleteUserCommand({
            UserPoolId: COGNITO_CONFIG.userPoolId,
            Username: googleUsername,
          }));
        } catch (e) {
          console.error("Failed to delete phantom google user:", e);
        }
      }
      createThrowError(400, "Conflict", "Email already exists. Try logging in with your email and password.", { email });
    }
  }
}

export async function signUpUser(data: RegisterRequest) {
  const { email, password, given_name, family_name, gender } = data;
  // Basic validation
  if (!email || !password || !given_name || !family_name || !gender) {
    createThrowError(400, "BadRequest", "All fields are required", { email });
  }
  if (
    password.includes(email) ||
    password.includes(given_name) ||
    password.includes(family_name)
  ) {
    createThrowError(
      400,
      "BadRequest",
      "Password cannot contain personal info",
      { email }
    );
  }

  // Prevent manual sign-up if the email is already used for Google sign-in
  await checkCognitoForDuplicateEmail(email, "manual");

  const input = {
    ClientId: process.env.COGNITO_CLIENT_ID!,
    Username: email,
    Password: password,
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "given_name", Value: given_name },
      { Name: "family_name", Value: family_name },
      { Name: "gender", Value: gender },
    ],
  };
  const command = new SignUpCommand(input);
  try {
    const response = await cognito.send(command);

    // Store in DynamoDB
    if (response.UserSub) {
      const userData = {
        ...data,
        sub: response.UserSub,
        // insertItemIntoDynamoDB auto-generates a random sk if none is given —
        // must be User#<sub> explicitly so profile/preferences lookups (which
        // key on User#<sub>) can find this row.
        sk: `${TABLE_PK_MAPPER.User}${response.UserSub}`,
        email_notifications: true,
        whatsapp_notifications: true,
      };
      // remove password before storing in DynamoDB
      delete (userData as any).password;

      // Ensure state is uppercase if provided
      if (userData.state) {
        userData.state = userData.state.toUpperCase();
      }

      await insertItemIntoDynamoDB(ALL_TABLE_NAMES.User, userData);
    }

    return response;
  } catch (error: any) {
    logErrorLocation(
      "authService.ts",
      "signUpUser",
      error,
      "AWS Cognito signup error",
      "",
      { data }
    );
    if (error.name === "UsernameExistsException") {
      createThrowError(400, "Conflict", "User already exists with this email", {
        email,
      });
    }
    createThrowError(
      500,
      "InternalServerError",
      error.message || "Failed to register user",
      { email }
    );
  }
}

export async function signInUser(email: string, password: string) {
  if (!email || !password) {
    createThrowError(400, "BadRequest", "Email and password required", {
      email,
    });
  }
  const input = {
    AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
    ClientId: process.env.COGNITO_CLIENT_ID!,
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  };
  const command = new InitiateAuthCommand(input);
  try {
    const response = await cognito.send(command);
    if (!response.AuthenticationResult) {
      createThrowError(401, "Unauthorized", "Authentication failed", { email });
    }
    return response.AuthenticationResult; // { AccessToken, IdToken, RefreshToken, ... }
  } catch (error: any) {
    logErrorLocation(
      "authService.ts",
      "signInUser",
      error,
      "AWS Cognito sign-in error",
      "",
      { email }
    );
    // Re-throw so the route catch block can map error.name to HTTP status/message
    throw error;
  }
}

export async function confirmSignUp(email: string, code: string) {
  if (!email || !code) {
    createThrowError(400, "BadRequest", "Email and code are required", { email });
  }
  const cmd = new ConfirmSignUpCommand({
    ClientId: process.env.COGNITO_CLIENT_ID!,
    Username: email,
    ConfirmationCode: code,
  });
  try {
    await cognito.send(cmd); // 200 OK if success
  } catch (error: any) {
    logErrorLocation(
      "authService.ts",
      "confirmSignUp",
      error,
      "AWS Cognito confirm sign-up error",
      "",
      { email }
    );
    throw error;
  }
}

export async function resendConfirmationCode(email: string) {
  if (!email) {
    createThrowError(400, "BadRequest", "Email is required", { email });
  }
  const cmd = new ResendConfirmationCodeCommand({
    ClientId: process.env.COGNITO_CLIENT_ID!,
    Username: email,
  });
  try {
    await cognito.send(cmd);
  } catch (error: any) {
    logErrorLocation(
      "authService.ts",
      "resendConfirmationCode",
      error,
      "AWS Cognito resend confirmation code error",
      "",
      { email }
    );
    throw error;
  }
}

export async function forgotPassword(email: string) {
  if (!email) {
    createThrowError(400, "BadRequest", "Email is required", { email });
  }
  const cmd = new ForgotPasswordCommand({
    ClientId: process.env.COGNITO_CLIENT_ID!,
    Username: email,
  });
  try {
    const response = await cognito.send(cmd);
    return response;
  } catch (error: any) {
    logErrorLocation(
      "authService.ts",
      "forgotPassword",
      error,
      "AWS Cognito forgot password error",
      "",
      { email }
    );
    throw error;
  }
}

export async function resetPassword(
  email: string,
  code: string,
  newPassword: string
) {
  if (!email || !code || !newPassword) {
    createThrowError(400, "BadRequest", "Email, code and new password are required", {
      email,
    });
  }
  const cmd = new ConfirmForgotPasswordCommand({
    ClientId: process.env.COGNITO_CLIENT_ID!,
    Username: email,
    ConfirmationCode: code,
    Password: newPassword,
  });
  try {
    const response = await cognito.send(cmd);
    return response;
  } catch (error: any) {
    logErrorLocation(
      "authService.ts",
      "resetPassword",
      error,
      "AWS Cognito reset password error",
      "",
      { email }
    );
    throw error;
  }
}

export async function updateProfile(accessToken: string, sub: string, data: Partial<IUser>) {
  // 1. Update Cognito (only specific fields). Best-effort: a Cognito sync
  // failure (e.g. access token missing the required OAuth scope) should
  // never block saving the rest of the profile (state, qualification,
  // percentage, etc.) to DynamoDB below.
  let cognitoSyncFailed = false;
  const cognitoAttributes = [];
  if (data.given_name) cognitoAttributes.push({ Name: "given_name", Value: data.given_name });
  if (data.family_name) cognitoAttributes.push({ Name: "family_name", Value: data.family_name });
  if (data.gender) cognitoAttributes.push({ Name: "gender", Value: data.gender });

  if (cognitoAttributes.length > 0) {
    const cmd = new UpdateUserAttributesCommand({
      AccessToken: accessToken,
      UserAttributes: cognitoAttributes,
    });
    try {
      await cognito.send(cmd);
    } catch (error: any) {
      logErrorLocation("authService.ts", "updateProfile (Cognito)", error, "AWS Cognito update error", "", { sub });
      cognitoSyncFailed = true;
    }
  }

  // 2. Update DynamoDB (all fields)
  const pk = TABLE_PK_MAPPER.User;
  const sk = `${TABLE_PK_MAPPER.User}${sub}`;

  // Ensure state is uppercase if provided
  if (data.state) {
    data.state = data.state.toUpperCase();
  }

  // Build update expression for DynamoDB
  const expressions: string[] = [];
  const expressionAttributeValues: any = {};
  const expressionAttributeNames: any = {};

  Object.entries(data).forEach(([key, value], index) => {
    if (key === "pk" || key === "sk" || key === "sub" || value === undefined) return;
    const nameKey = `#field${index}`;
    const valueKey = `:val${index}`;
    expressions.push(`${nameKey} = ${valueKey}`);
    expressionAttributeNames[nameKey] = key;
    expressionAttributeValues[valueKey] = value;
  });

  if (expressions.length > 0) {
    const updateItemParam = {
      Key: { pk, sk },
      UpdateExpression: "set " + expressions.join(", "),
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    };

    try {
      await updateItemDynamoDB(updateItemParam);
    } catch (error: any) {
      logErrorLocation("authService.ts", "updateProfile (DynamoDB)", error, "DynamoDB update error", "", { sub, data });
      throw error;
    }
  }

  return { cognitoSyncFailed };
}

export async function getUserProfile(sub: string) {
  const pk = TABLE_PK_MAPPER.User;
  const sk = `${TABLE_PK_MAPPER.User}${sub}`;
  try {
    const results = await fetchDynamoDB(ALL_TABLE_NAMES.User, sk);
    return results.length > 0 ? (results[0] as IUser) : null;
  } catch (error: any) {
    logErrorLocation("authService.ts", "getUserProfile", error, "DynamoDB fetch error", "", { sub });
    throw error;
  }
}

export interface INotificationPreferences {
  email_notifications?: boolean;
  whatsapp_notifications?: boolean;
  subscribed_topics?: string[];
}

// Only these keys are ever written by updateNotificationPreferences, even if
// the request body contains other IUser fields — keeps this endpoint from
// being usable to change profile data that PUT /auth/profile owns.
const NOTIFICATION_PREFERENCE_FIELDS = ["email_notifications", "whatsapp_notifications", "subscribed_topics"] as const;
const VALID_TOPIC_VALUES = new Set(TOPICS.map((t) => t.value));

export async function getNotificationPreferences(sub: string): Promise<INotificationPreferences> {
  const user = await getUserProfile(sub);
  return {
    email_notifications: user?.email_notifications !== false,
    whatsapp_notifications: user?.whatsapp_notifications !== false,
    subscribed_topics: user?.subscribed_topics || [],
  };
}

export async function updateNotificationPreferences(sub: string, data: INotificationPreferences): Promise<void> {
  if (data.subscribed_topics) {
    const invalidTopics = data.subscribed_topics.filter((t) => !VALID_TOPIC_VALUES.has(t));
    if (invalidTopics.length > 0) {
      createThrowError(400, "BadRequest", `Invalid topic(s): ${invalidTopics.join(", ")}`, { invalidTopics });
    }
  }

  const pk = TABLE_PK_MAPPER.User;
  const sk = `${TABLE_PK_MAPPER.User}${sub}`;

  const expressions: string[] = [];
  const expressionAttributeValues: any = {};
  const expressionAttributeNames: any = {};

  NOTIFICATION_PREFERENCE_FIELDS.forEach((key, index) => {
    const value = data[key];
    if (value === undefined) return;
    const nameKey = `#field${index}`;
    const valueKey = `:val${index}`;
    expressions.push(`${nameKey} = ${valueKey}`);
    expressionAttributeNames[nameKey] = key;
    expressionAttributeValues[valueKey] = value;
  });

  if (expressions.length === 0) return;

  const updateItemParam = {
    Key: { pk, sk },
    UpdateExpression: "set " + expressions.join(", "),
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  };

  try {
    await updateItemDynamoDB(updateItemParam);
  } catch (error: any) {
    logErrorLocation("authService.ts", "updateNotificationPreferences", error, "DynamoDB update error", "", { sub, data });
    throw error;
  }
}

export async function getCognitoUserEmail(sub: string): Promise<string | undefined> {
  const cmd = new AdminGetUserCommand({
    UserPoolId: process.env.COGNITO_USER_POOL_ID!,
    Username: sub,
  });
  try {
    const response = await cognito.send(cmd);
    const emailAttr = response.UserAttributes?.find(attr => attr.Name === "email");
    return emailAttr?.Value;
  } catch (error) {
    console.error("Cognito AdminGetUser error:", error);
    return undefined;
  }
}

/**
 * Exchange the Cognito authorization code for access + id tokens.
 * Called after the user is redirected back from the Cognito Hosted UI.
 */
export async function exchangeGoogleCode(
  code: string
): Promise<{ access_token: string; id_token: string; refresh_token?: string }> {
  const { domain, clientId, googleCallbackUrl } = COGNITO_CONFIG;

  if (!domain || !clientId || !googleCallbackUrl) {
    throw new Error(
      "Missing Cognito OAuth config. Ensure COGNITO_DOMAIN, COGNITO_CLIENT_ID, GOOGLE_CALLBACK_URL are set."
    );
  }

  // Build URL-encoded body for the token endpoint
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: googleCallbackUrl,
  }).toString();

  const url = new URL(`${domain}/oauth2/token`);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              console.error("Cognito token exchange error response:", parsed);
              return reject(new Error(parsed.error_description || parsed.error));
            }
            resolve(parsed);
          } catch (e) {
            console.error("Failed to parse Cognito token response. Raw data:", data);
            reject(new Error("Failed to parse token response"));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Decode a Cognito ID token (JWT) — no signature verification needed here
 * since the token came directly from Cognito's token endpoint over HTTPS.
 */
function decodeIdToken(idToken: string): Record<string, any> {
  const payload = idToken.split(".")[1];
  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  return JSON.parse(decoded);
}

/**
 * After a successful Google sign-in, look up the user in DynamoDB by their Cognito sub.
 * If no entry exists (first-time Google sign-in), create one automatically.
 * Returns the user's sub and basic profile info.
 */
export async function getOrCreateGoogleUser(idToken: string): Promise<{
  sub: string;
  email: string;
  given_name: string;
  family_name: string;
  isNew: boolean;
}> {
  const claims = decodeIdToken(idToken);
  const sub: string = claims.sub;
  const email: string = claims.email || "";
  const given_name: string = claims.given_name || "";
  const family_name: string = claims.family_name || claims.name?.split(" ").slice(1).join(" ") || "";

  // Check if user already exists in DynamoDB
  const pk = TABLE_PK_MAPPER.User;
  const sk = `${pk}${sub}`;
  let existingResults: any[];
  try {
    existingResults = await fetchDynamoDB(ALL_TABLE_NAMES.User, sk);
  } catch (err) {
    existingResults = [];
  }

  const isNew = !existingResults || existingResults.length === 0;

  if (isNew) {
    // Prevent Google sign-in if the email is already used for manual sign-up
    await checkCognitoForDuplicateEmail(email, "google");

    // Create a minimal user profile on first Google sign-in.
    // Non-critical fields (state, category, etc.) are left empty — user can fill them in profile.
    const userRecord: Partial<IUser> & { pk?: string; sk?: string; sub?: string } = {
      email,
      given_name,
      family_name,
      sub,
      auth_provider: "google",
      is_verified: true,
      email_notifications: true,
      whatsapp_notifications: true,
    };

    // insertItemIntoDynamoDB auto-generates pk/sk — but for users we want sk = User#<sub>
    // So we manually set pk and sk before inserting.
    userRecord.pk = pk;
    userRecord.sk = sk;

    try {
      const { PutItemCommand, DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
      const { marshall } = await import("@aws-sdk/util-dynamodb");
      const { dynamoDBClient } = await import("../aws/dynamodb.client");
      const { DYNAMODB_CONFIG } = await import("../config/env");

      const now = Date.now();
      const item = {
        ...userRecord,
        created_at: now,
        modified_at: now,
      };

      const dynamoDB = new DynamoDBClient(dynamoDBClient);
      await dynamoDB.send(
        new PutItemCommand({
          TableName: DYNAMODB_CONFIG.TABLE_NAME,
          Item: marshall(item, { removeUndefinedValues: true }),
        })
      );
    } catch (err) {
      logErrorLocation(
        "authService.ts",
        "getOrCreateGoogleUser",
        err,
        "Failed to create DynamoDB user entry for Google sign-in",
        "",
        { sub, email }
      );
      // Don't block sign-in even if DynamoDB write fails
    }
  }

  return { sub, email, given_name, family_name, isNew };
}
