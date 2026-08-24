import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import { IUser } from "../../db_schema/User/UserInterface";
import { TABLE_PK_MAPPER } from "../../db_schema/shared/SharedConstant";
import { queryItemsFromDynamoDB } from "../../dynamoDB_CRUD/fetchData";
import { COGNITO_CONFIG, DYNAMODB_CONFIG } from "../../config/env";
import { QueryCommandInput } from "@aws-sdk/client-dynamodb";
import { logErrorLocation } from "../../utils/errorUtils";

const cognito = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || COGNITO_CONFIG.region,
});

export interface IUserStatsResponse {
  totalUsers: number;
  googleUsers: number;
  manualUsers: number;
  byCategory: Record<string, number>;
  byState: Record<string, number>;
  recentUsers: Array<{
    sub?: string;
    email: string;
    given_name: string;
    family_name: string;
    gender?: string;
    state?: string;
    category?: string;
    auth_provider?: string;
    created_at?: number;
    user_status?: string;
    enabled?: boolean;
  }>;
}

/**
 * Helper to fetch all users directly from the AWS Cognito User Pool.
 */
async function fetchAllCognitoUsers(): Promise<UserType[]> {
  const users: UserType[] = [];
  let paginationToken: string | undefined = undefined;

  do {
    const cmd: ListUsersCommand = new ListUsersCommand({
      UserPoolId: COGNITO_CONFIG.userPoolId,
      PaginationToken: paginationToken,
      Limit: 60,
    });

    const res = await cognito.send(cmd);
    if (res.Users && res.Users.length > 0) {
      users.push(...res.Users);
    }
    paginationToken = res.PaginationToken;
  } while (paginationToken);

  return users;
}

export async function getUserPlatformStats(
  timeRange: string = "all"
): Promise<IUserStatsResponse> {
  try {
    // 1. Fetch only real users present in AWS Cognito User Pool
    const cognitoUsers = await fetchAllCognitoUsers();

    // 2. Fetch DynamoDB user profiles to enrich state, category, etc.
    const pk = TABLE_PK_MAPPER.User;
    const params: QueryCommandInput = {
      TableName: DYNAMODB_CONFIG.TABLE_NAME,
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: {
        "#pk": "pk",
      },
      ExpressionAttributeValues: {
        ":pk": pk as any,
      },
    };

    let dynamoUsers: IUser[] = [];
    try {
      dynamoUsers = await queryItemsFromDynamoDB<IUser>(params);
    } catch (e) {
      console.warn("Could not fetch DynamoDB profiles, falling back to Cognito attributes:", e);
    }

    // Map DynamoDB users by sub and email for fast enrichment
    const dynamoBySub = new Map<string, IUser>();
    const dynamoByEmail = new Map<string, IUser>();
    for (const dUser of dynamoUsers) {
      if (dUser.sub) dynamoBySub.set(dUser.sub, dUser);
      if (dUser.email) dynamoByEmail.set(dUser.email.toLowerCase(), dUser);
    }

    // Determine time range cutoff
    let startTimeMillis = 0;
    if (timeRange && timeRange !== "all") {
      const now = new Date();
      switch (timeRange) {
        case "today":
          now.setHours(0, 0, 0, 0);
          startTimeMillis = now.getTime();
          break;
        case "last_week":
          startTimeMillis = now.getTime() - 7 * 24 * 60 * 60 * 1000;
          break;
        case "last_month":
          now.setMonth(now.getMonth() - 1);
          startTimeMillis = now.getTime();
          break;
        case "last_3_months":
          now.setMonth(now.getMonth() - 3);
          startTimeMillis = now.getTime();
          break;
        case "last_6_months":
          now.setMonth(now.getMonth() - 6);
          startTimeMillis = now.getTime();
          break;
      }
    }

    // Process each Cognito user
    const processedUsers = cognitoUsers.map((cUser) => {
      const attrs = (cUser.Attributes || []).reduce<Record<string, string>>((acc, a) => {
        if (a.Name && a.Value) acc[a.Name] = a.Value;
        return acc;
      }, {});

      const sub = attrs.sub || cUser.Username || "";
      const email = (attrs.email || "").toLowerCase();
      const isGoogle =
        cUser.UserStatus === "EXTERNAL_PROVIDER" ||
        (cUser.Username && cUser.Username.startsWith("google_"));
      const auth_provider = isGoogle ? "google" : "email";

      const createdAt = cUser.UserCreateDate
        ? new Date(cUser.UserCreateDate).getTime()
        : Date.now();

      // Find matching DynamoDB profile
      const dProfile = dynamoBySub.get(sub) || dynamoByEmail.get(email);

      return {
        sub,
        email: email || (cUser.Username || "unknown"),
        given_name: attrs.given_name || dProfile?.given_name || "",
        family_name: attrs.family_name || dProfile?.family_name || "",
        gender: attrs.gender || dProfile?.gender || "",
        state: dProfile?.state || "",
        category: dProfile?.category || "",
        auth_provider,
        created_at: createdAt,
        user_status: cUser.UserStatus,
        enabled: cUser.Enabled ?? true,
      };
    });

    // Apply time-range filter
    const filteredUsers = startTimeMillis > 0
      ? processedUsers.filter((u) => u.created_at >= startTimeMillis)
      : processedUsers;

    let googleUsers = 0;
    let manualUsers = 0;
    const byCategory: Record<string, number> = {};
    const byState: Record<string, number> = {};

    for (const u of filteredUsers) {
      if (u.auth_provider === "google") {
        googleUsers++;
      } else {
        manualUsers++;
      }

      const cat = u.category?.trim() || "Unspecified";
      byCategory[cat] = (byCategory[cat] || 0) + 1;

      const st = u.state?.trim() || "Unspecified";
      byState[st] = (byState[st] || 0) + 1;
    }

    // Sort descending by created_at
    const sorted = [...filteredUsers].sort((a, b) => b.created_at - a.created_at);

    const recentUsers = sorted.slice(0, 30);

    return {
      totalUsers: filteredUsers.length,
      googleUsers,
      manualUsers,
      byCategory,
      byState,
      recentUsers,
    };
  } catch (error) {
    logErrorLocation(
      "userService.ts",
      "getUserPlatformStats",
      error,
      "Error fetching Cognito user platform stats",
      "",
      { timeRange }
    );
    return {
      totalUsers: 0,
      googleUsers: 0,
      manualUsers: 0,
      byCategory: {},
      byState: {},
      recentUsers: [],
    };
  }
}
