/**
 * Ice Cream App Backend – callable API for Android and iOS clients.
 */

import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import {setGlobalOptions} from "firebase-functions";
import {defineString} from "firebase-functions/params";
import {getMessaging} from "firebase-admin/messaging";
import * as admin from "firebase-admin";

const googleMapsApiKey = defineString("GOOGLE_MAPS_API_KEY");

if (!admin.apps.length) {
  admin.initializeApp();
}

setGlobalOptions({maxInstances: 10});

/** Shape of a menu item returned by getIceCreamMenu */
export interface IceCreamMenuItem {
  id: string;
  name: string;
  description: string;
}

/** Request body for requestIceCream */
interface RequestIceCreamData {
  flavorId: string;
  flavorName: string;
}

/** Response from requestIceCream */
interface RequestIceCreamResponse {
  success: boolean;
  message: string;
  orderId?: string;
}

const MOCK_MENU: IceCreamMenuItem[] = [
  {id: "vanilla", name: "Vanilla", description: "Classic smooth vanilla"},
  {id: "chocolate", name: "Chocolate", description: "Rich dark chocolate"},
  {id: "strawberry", name: "Strawberry", description: "Fresh strawberry"},
  {
    id: "mint",
    name: "Mint Chip",
    description: "Cool mint with chocolate chips",
  },
];

/**
 * Returns the ice cream menu. Callable from Android and iOS.
 */
export const getIceCreamMenu = onCall<void, IceCreamMenuItem[]>(() => {
  return MOCK_MENU;
});

/**
 * Submits an ice cream request. Callable from Android and iOS.
 */
export const requestIceCream =
  onCall<RequestIceCreamData, RequestIceCreamResponse>((request) => {
    const data = request.data;
    if (!data || typeof data !== "object") {
      throw new HttpsError("invalid-argument", "Missing request data");
    }
    const {flavorId, flavorName} = data;
    if (!flavorId || !flavorName) {
      throw new HttpsError(
        "invalid-argument",
        "flavorId and flavorName are required"
      );
    }
    const orderId =
      `order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      success: true,
      message: `Your ${flavorName} ice cream request has been received.`,
      orderId,
    };
  });

/** Request body for sendTestNotification */
interface SendTestNotificationData {
  fcmToken: string;
  title?: string;
  body?: string;
}

/**
 * Sends a test push notification to the given FCM token (for testing setup).
 * Call from your app or a script after getting the device token.
 */
export const sendTestNotification = onCall<
  SendTestNotificationData,
  Promise<{success: boolean; message: string}>
>(async (request) => {
  const data = request.data;
  if (!data || typeof data !== "object" || !data.fcmToken) {
    throw new HttpsError("invalid-argument", "fcmToken is required");
  }
  const {
    fcmToken,
    title = "Ice Cream App",
    body = "Your ice cream is ready!",
  } = data;
  try {
    await getMessaging().send({
      token: fcmToken,
      notification: {title, body},
      android: {priority: "high"},
      apns: {
        payload: {
          aps: {
            sound: "default",
            alert: {title, body},
          },
        },
      },
    });
    return {success: true, message: "Notification sent."};
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HttpsError("internal", `Failed to send: ${msg}`);
  }
});

/** Request body for registerDeviceToken */
interface RegisterDeviceTokenData {
  fcmToken: string;
  platform: "android" | "ios";
}

const DEVICE_TOKENS_COLLECTION = "deviceTokens";

/**
 * Registers the device FCM token in Firestore.
 * Call from Android/iOS once push is permitted.
 */
export const registerDeviceToken =
  onCall<
    RegisterDeviceTokenData,
    Promise<{success: boolean}>
  >(async (request) => {
    const data = request.data;
    if (!data || typeof data !== "object" || !data.fcmToken) {
      throw new HttpsError("invalid-argument", "fcmToken is required");
    }
    const platform = data.platform === "ios" ? "ios" : "android";
    const fcmToken = String(data.fcmToken).trim();
    if (!fcmToken) {
      throw new HttpsError("invalid-argument", "fcmToken is required");
    }
    const db = admin.firestore();
    const docId =
      fcmToken.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 150) || "unknown";
    await db.collection(DEVICE_TOKENS_COLLECTION).doc(docId).set({
      fcmToken,
      platform,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    return {success: true};
  });

/** Request body for requestIceCreamDropoff */
interface RequestIceCreamDropoffData {
  name: string;
  phoneNumber: string;
  latitude: number;
  longitude: number;
}

/** Firestore collection for dropoff requests (name, phone, coordinates). */
const DROPOFF_REQUESTS_COLLECTION = "dropoffRequests";

/** One dropoff request as returned by getDropoffRequests. */
interface DropoffRequestItem {
  id: string;
  name: string;
  phoneNumber: string;
  latitude: number;
  longitude: number;
  /** Present when done (e.g. "Approved", "Canceled"). Omitted for pending. */
  status?: string;
}

/**
 * Returns dropoff requests: pending (done !== true) and approved
 * (status === "Approved"). Use for map/route and ETA list.
 * Admin list should filter to pending only.
 */
export const getDropoffRequests =
  onCall<void, Promise<{requests: DropoffRequestItem[]}>>(async () => {
    const db = admin.firestore();
    const snapshot =
      await db.collection(DROPOFF_REQUESTS_COLLECTION).get();
    const requests: DropoffRequestItem[] = [];
    snapshot.docs.forEach((doc) => {
      const d = doc.data();
      const name = d.name;
      const phoneNumber = d.phoneNumber;
      const lat = d.latitude;
      const lng = d.longitude;
      if (
        typeof name !== "string" || typeof phoneNumber !== "string" ||
        typeof lat !== "number" || typeof lng !== "number"
      ) {
        return;
      }
      const done = d.done === true;
      const status = d.status === "Approved" || d.status === "Canceled" ?
        d.status as string :
        undefined;
      if (done && status !== "Approved") return;
      requests.push({
        id: doc.id,
        name,
        phoneNumber,
        latitude: lat,
        longitude: lng,
        ...(status && {status}),
      });
    });
    return {requests};
  });

/**
 * Submits an ice cream dropoff request with name, phone, and coordinates.
 * Persists to Firestore (collection: dropoffRequests).
 */
export const requestIceCreamDropoff = onCall<
  RequestIceCreamDropoffData,
  Promise<{success: boolean}>
>(async (request) => {
  const data = request.data;
  if (!data || typeof data !== "object") {
    throw new HttpsError("invalid-argument", "Missing request data");
  }
  const name = String(data.name ?? "").trim();
  const phoneNumber = String(data.phoneNumber ?? "").trim();
  const latitude = Number(data.latitude);
  const longitude = Number(data.longitude);
  if (!name) {
    throw new HttpsError("invalid-argument", "Name is required");
  }
  if (!phoneNumber) {
    throw new HttpsError("invalid-argument", "Phone number is required");
  }
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    throw new HttpsError(
      "invalid-argument",
      "Valid coordinates are required"
    );
  }
  const db = admin.firestore();
  await db.collection(DROPOFF_REQUESTS_COLLECTION).add({
    name,
    phoneNumber,
    latitude,
    longitude,
    done: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return {success: true};
});

/** Request body for markDropoffDone */
interface MarkDropoffDoneData {
  dropoffId: string;
}

/**
 * Marks a dropoff request as done. Call from Android when user taps Done.
 */
export const markDropoffDone =
  onCall<MarkDropoffDoneData, Promise<{success: boolean}>>(async (request) => {
    const data = request.data;
    if (!data || typeof data !== "object" || !data.dropoffId) {
      throw new HttpsError("invalid-argument", "dropoffId is required");
    }
    const dropoffId = String(data.dropoffId).trim();
    if (!dropoffId) {
      throw new HttpsError("invalid-argument", "dropoffId is required");
    }
    const db = admin.firestore();
    await db.collection(DROPOFF_REQUESTS_COLLECTION).doc(dropoffId).update({
      done: true,
      doneAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {success: true};
  });

/** Request body for updateDropoffStatus */
interface UpdateDropoffStatusData {
  dropoffId: string;
  status: "Approved" | "Canceled";
}

/**
 * Updates a dropoff request with status Approved or Canceled.
 * Call from Android when user taps Approve or Cancel.
 */
export const updateDropoffStatus =
  onCall<
    UpdateDropoffStatusData,
    Promise<{success: boolean}>
  >(async (request) => {
    const data = request.data;
    if (!data || typeof data !== "object" || !data.dropoffId) {
      throw new HttpsError("invalid-argument", "dropoffId is required");
    }
    const dropoffId = String(data.dropoffId).trim();
    if (!dropoffId) {
      throw new HttpsError("invalid-argument", "dropoffId is required");
    }
    const status = data.status === "Canceled" ? "Canceled" : "Approved";
    const db = admin.firestore();
    await db.collection(DROPOFF_REQUESTS_COLLECTION).doc(dropoffId).update({
      status,
      done: true,
      doneAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {success: true};
  });

/** Request body for getOptimizedRoute. Origin = admin; waypoints = dropoffs. */
interface GetOptimizedRouteData {
  origin?: {latitude?: number; longitude?: number};
  waypoints?: Array<{
    latitude?: number;
    longitude?: number;
    [key: string]: unknown;
  }>;
}

/** Response: optimized order, leg durations (seconds), polyline for map. */
interface OptimizedRouteResult {
  waypointOrder: number[];
  legDurationsSeconds: number[];
  encodedPolyline: string;
}

const DIRECTIONS_LOG_PREFIX = "[getOptimizedRoute]";
const MAX_WAYPOINTS = 25;

/**
 * Parses a value as a finite number (number or numeric string).
 * Returns null if invalid.
 * @param {unknown} v - Value to parse (number or string).
 * @return {number|null} Finite number or null if invalid.
 */
function parseNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Returns an optimized route from origin through all waypoints (and back).
 * Uses Google Directions API with waypoint optimization.
 * Set GOOGLE_MAPS_API_KEY in config.
 */
export const getOptimizedRoute = onCall<
  GetOptimizedRouteData,
  Promise<OptimizedRouteResult>
>(async (request) => {
  const data = request.data;
  if (!data || typeof data !== "object") {
    throw new HttpsError(
      "invalid-argument",
      "Request must include data object with origin and waypoints",
    );
  }
  const rawOrigin = data.origin;
  const lat = parseNum(rawOrigin?.latitude);
  const lng = parseNum(rawOrigin?.longitude);
  if (lat == null || lng == null ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new HttpsError(
      "invalid-argument",
      "origin must have valid latitude and longitude (numbers in valid range)",
    );
  }
  const origin = {latitude: lat, longitude: lng};

  const rawWaypoints = Array.isArray(data.waypoints) ? data.waypoints : [];
  const waypoints: Array<{latitude: number; longitude: number}> = [];
  for (let i = 0; i < Math.min(rawWaypoints.length, MAX_WAYPOINTS); i++) {
    const w = rawWaypoints[i] as Record<string, unknown> | undefined;
    if (!w || typeof w !== "object") continue;
    const wLat = parseNum(w.latitude);
    const wLng = parseNum(w.longitude);
    const validLat = wLat != null && wLat >= -90 && wLat <= 90;
    const validLng = wLng != null && wLng >= -180 && wLng <= 180;
    if (validLat && validLng) {
      waypoints.push({latitude: wLat, longitude: wLng});
    }
  }
  if (rawWaypoints.length > MAX_WAYPOINTS) {
    console.warn(DIRECTIONS_LOG_PREFIX, "Waypoints capped at", MAX_WAYPOINTS);
  }

  console.log(DIRECTIONS_LOG_PREFIX, "Request:", {
    origin: `${origin.latitude},${origin.longitude}`,
    waypointCount: waypoints.length,
  });
  if (waypoints.length === 0) {
    console.log(
      DIRECTIONS_LOG_PREFIX,
      "No valid waypoints, returning empty result",
    );
    return {
      waypointOrder: [],
      legDurationsSeconds: [],
      encodedPolyline: "",
    };
  }
  const apiKey = googleMapsApiKey.value();
  if (!apiKey) {
    console.error(DIRECTIONS_LOG_PREFIX, "GOOGLE_MAPS_API_KEY not configured");
    throw new HttpsError(
      "failed-precondition",
      "GOOGLE_MAPS_API_KEY not configured",
    );
  }
  const o = `${origin.latitude},${origin.longitude}`;
  const waypointsParam = "optimize:true|" +
    waypoints.map((w) => `${w.latitude},${w.longitude}`).join("|");
  const url = "https://maps.googleapis.com/maps/api/directions/json?" +
    `origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(o)}` +
    `&waypoints=${encodeURIComponent(waypointsParam)}&key=${apiKey}`;
  console.log(
    DIRECTIONS_LOG_PREFIX,
    "Calling Directions API (origin/dest same, optimize:true)",
  );
  const res = await fetch(url);
  const json = await res.json() as {
    status?: string;
    error_message?: string;
    routes?: Array<{
      legs?: Array<{duration?: {value: number}}>;
      overview_polyline?: {points?: string};
      waypoint_order?: number[];
    }>;
  };
  const status = json.status;
  const errorMessage = json.error_message;
  const firstRoute = json.routes?.[0];
  if (status !== "OK" || !firstRoute) {
    const detail = errorMessage ?
      `${status}: ${errorMessage}` :
      (status || "no route");
    console.error(DIRECTIONS_LOG_PREFIX, "Directions API error:", detail);
    throw new HttpsError(
      "internal",
      "Directions API error: " + detail,
    );
  }
  const legs = firstRoute.legs || [];
  const rawWaypointOrder = firstRoute.waypoint_order || [];
  const rawLegDurations = legs
    .slice(0, waypoints.length)
    .map((leg) => leg.duration?.value ?? 0);
  const len = Math.min(rawWaypointOrder.length, rawLegDurations.length);
  const waypointOrder = rawWaypointOrder.slice(0, len);
  const legDurationsSeconds = rawLegDurations.slice(0, len);
  const encodedPolyline = firstRoute.overview_polyline?.points ?? "";
  console.log(DIRECTIONS_LOG_PREFIX, "Directions API OK:", {
    waypointOrderLength: waypointOrder.length,
    legDurationsLength: legDurationsSeconds.length,
    polylineLength: encodedPolyline.length,
  });
  return {
    waypointOrder,
    legDurationsSeconds,
    encodedPolyline,
  };
});

/** Optional secret for sendPushNotification. Set NOTIFY_SECRET in config. */
const NOTIFY_SECRET = process.env.NOTIFY_SECRET || "";

/**
 * HTTP route to send a push notification with a custom message (for curl).
 * POST JSON: { "message": "text", "title": "Optional", "token": "fcm token" }
 *   or use "topic": "topicName" instead of "token".
 * If NOTIFY_SECRET is set, include header: x-notify-key: <NOTIFY_SECRET>
 */
export const sendPushNotification = onRequest(
  {cors: true},
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({error: "Method not allowed. Use POST."});
      return;
    }
    if (NOTIFY_SECRET && req.headers["x-notify-key"] !== NOTIFY_SECRET) {
      res.status(401).json({error: "Unauthorized. Set x-notify-key header."});
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") {
      res.status(400).json({error: "JSON body required."});
      return;
    }
    const message =
      (body.message as string) ?? (body.body as string) ?? "";
    const title = (body.title as string) ?? "Ice Cream App";
    const token = body.token as string | undefined;
    const topic = body.topic as string | undefined;
    if (!message.trim()) {
      res.status(400).json({error: "Body must include 'message' or 'body'."});
      return;
    }
    if (!token && !topic) {
      res.status(400).json({
        error: "Body must include 'token' (FCM token) or 'topic'.",
      });
      return;
    }
    try {
      const bodyText = message.trim();
      const notification = {title, body: bodyText};
      const android = {priority: "high" as const};
      // APNs: explicit alert + headers so iOS displays the notification.
      const apns = {
        headers: {
          "apns-push-type": "alert",
          "apns-priority": "10",
        },
        payload: {
          aps: {
            sound: "default",
            alert: {title, body: bodyText},
          },
        },
      };
      if (token) {
        await getMessaging().send({
          token,
          notification,
          android,
          apns,
        });
      } else if (topic) {
        await getMessaging().send({
          topic,
          notification,
          android,
          apns,
        });
      }
      res.status(200).json({success: true, message: "Notification sent."});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({success: false, error: `Failed to send: ${msg}`});
    }
  }
);
