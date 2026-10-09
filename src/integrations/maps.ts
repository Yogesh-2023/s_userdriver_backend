import { env } from "../config/env";
import { errors } from "../common/errors";

const getFallbackRoute = (
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
) => {
  const R = 6371000;
  const dLat = ((destination.latitude - origin.latitude) * Math.PI) / 180;
  const dLon = ((destination.longitude - origin.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((origin.latitude * Math.PI) / 180) *
      Math.cos((destination.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightDistanceMeters = R * c;
  const distanceMeters = Math.max(
    1000,
    Math.round(straightDistanceMeters * 1.3),
  );
  const durationSeconds = Math.max(
    300,
    Math.round((distanceMeters / 1000) * 144),
  );

  return {
    distanceMeters,
    durationSeconds,
    encodedPolyline: "",
    provider: "fallback",
  };
};

export const getRoute = async (
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
) => {
  if (!env.GOOGLE_MAPS_API_KEY) {
    return getFallbackRoute(origin, destination);
  }
  try {
    const response = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": env.GOOGLE_MAPS_API_KEY,
          "x-goog-fieldmask":
            "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
        },
        body: JSON.stringify({
          origin: {
            location: {
              latLng: {
                latitude: origin.latitude,
                longitude: origin.longitude,
              },
            },
          },
          destination: {
            location: {
              latLng: {
                latitude: destination.latitude,
                longitude: destination.longitude,
              },
            },
          },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
        }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) {
      console.warn("Google Maps API failed status:", response.status);
      return getFallbackRoute(origin, destination);
    }
    const payload = (await response.json()) as {
      routes?: Array<{
        distanceMeters?: number;
        duration?: string;
        polyline?: { encodedPolyline?: string };
      }>;
    };
    const route = payload.routes?.[0];
    if (!route?.distanceMeters || !route.duration) {
      return getFallbackRoute(origin, destination);
    }
    return {
      distanceMeters: route.distanceMeters,
      durationSeconds: Math.ceil(Number.parseFloat(route.duration)),
      encodedPolyline: route.polyline?.encodedPolyline ?? "",
      provider: "google",
    };
  } catch (e) {
    console.warn("Google Maps API call failed, using fallback:", e);
    return getFallbackRoute(origin, destination);
  }
};

export const getEta = async (
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
) => {
  if (!env.GOOGLE_MAPS_API_KEY) {
    const fallback = getFallbackRoute(origin, destination);
    return {
      distanceMeters: fallback.distanceMeters,
      durationSeconds: fallback.durationSeconds,
    };
  }
  try {
    const response = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": env.GOOGLE_MAPS_API_KEY,
          "x-goog-fieldmask": "routes.distanceMeters,routes.duration",
        },
        body: JSON.stringify({
          origin: {
            location: {
              latLng: {
                latitude: origin.latitude,
                longitude: origin.longitude,
              },
            },
          },
          destination: {
            location: {
              latLng: {
                latitude: destination.latitude,
                longitude: destination.longitude,
              },
            },
          },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
        }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) {
      const fallback = getFallbackRoute(origin, destination);
      return {
        distanceMeters: fallback.distanceMeters,
        durationSeconds: fallback.durationSeconds,
      };
    }
    const payload = (await response.json()) as {
      routes?: Array<{
        distanceMeters?: number;
        duration?: string;
      }>;
    };
    const route = payload.routes?.[0];
    if (!route?.distanceMeters || !route.duration) {
      const fallback = getFallbackRoute(origin, destination);
      return {
        distanceMeters: fallback.distanceMeters,
        durationSeconds: fallback.durationSeconds,
      };
    }
    return {
      distanceMeters: route.distanceMeters,
      durationSeconds: Math.ceil(Number.parseFloat(route.duration)),
    };
  } catch (e) {
    const fallback = getFallbackRoute(origin, destination);
    return {
      distanceMeters: fallback.distanceMeters,
      durationSeconds: fallback.durationSeconds,
    };
  }
};
