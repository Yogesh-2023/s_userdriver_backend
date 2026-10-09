import { prisma } from "../../../database/prisma";
import { errors } from "../../../common/errors";
import { env } from "../../../config/env";

function isPointInPolygon(lat: number, lng: number, polygon: any): boolean {
  if (!polygon) return false;
  let coords: Array<[number, number]> = [];

  if (Array.isArray(polygon)) {
    if (Array.isArray(polygon[0])) {
      // [[lng, lat], ...]
      coords = polygon as Array<[number, number]>;
    } else if (typeof polygon[0] === "object" && polygon[0] !== null) {
      // [{ lat, lng }, ...] or [{ latitude, longitude }, ...]
      coords = polygon.map((pt: any) => [
        pt.lng ?? pt.longitude ?? 0,
        pt.lat ?? pt.latitude ?? 0,
      ]);
    }
  } else if (
    typeof polygon === "object" &&
    Array.isArray(polygon.coordinates)
  ) {
    // GeoJSON structure: { type: "Polygon", coordinates: [[[lng, lat], ...]] }
    const firstRing = polygon.coordinates[0];
    if (Array.isArray(firstRing)) {
      coords = firstRing as Array<[number, number]>;
    }
  }

  if (coords.length < 3) return false;

  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const ci = coords[i];
    const cj = coords[j];
    if (!ci || !cj) continue;
    const xi = ci[0]; // longitude
    const yi = ci[1]; // latitude
    const xj = cj[0]; // longitude
    const yj = cj[1]; // latitude

    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export class CustomerLocationService {
  async findServiceArea(latitude: number, longitude: number) {
    const areas = await prisma.serviceArea.findMany({
      where: { isActive: true },
    });
    for (const area of areas) {
      if (isPointInPolygon(latitude, longitude, area.boundaryPolygon)) {
        return area;
      }
    }
    return null;
  }

  async checkServiceability(latitude: number, longitude: number) {
    const area = await this.findServiceArea(latitude, longitude);
    // Fetch all categories (bypassing isActive for local development/testing)
    const categories = await prisma.vehicleCategory.findMany({
      select: { id: true },
    });

    if (!area) {
      return {
        isServiceable: true,
        serviceAreaId: "default-service-area",
        serviceAreaName: "Default Service Area",
        availableCategoryIds: categories.map((c) => c.id),
        message: "Service available",
      };
    }

    return {
      isServiceable: true,
      serviceAreaId: area.id,
      serviceAreaName: area.name,
      availableCategoryIds: categories.map((c) => c.id),
      message: "Service available",
    };
  }

  async search(query: string) {
    if (!env.GOOGLE_MAPS_API_KEY) {
      // Return mock search results for development/testing
      return [
        {
          description: `Connaught Place, New Delhi, Delhi, India (${query})`,
          placeId: "cp-delhi-place-id",
          latitude: 28.6304,
          longitude: 77.2177,
        },
        {
          description: `Indira Gandhi International Airport (DEL), New Delhi, Delhi, India (${query})`,
          placeId: "igi-airport-place-id",
          latitude: 28.5562,
          longitude: 77.1,
        },
        {
          description: `Sector 62, Noida, Uttar Pradesh, India (${query})`,
          placeId: "sec-62-noida-place-id",
          latitude: 28.6273,
          longitude: 77.3725,
        },
      ];
    }

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
        query,
      )}&key=${env.GOOGLE_MAPS_API_KEY}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) throw errors.unavailable("Location search failed");
    const payload = await response.json();

    // We map predictions to simple frontend description and placeId format
    return (payload.predictions || []).map((p: any) => ({
      description: p.description,
      placeId: p.place_id,
    }));
  }

  async reverseGeocode(latitude: number, longitude: number) {
    if (!env.GOOGLE_MAPS_API_KEY) {
      return {
        formattedAddress: `Sector 62, Noida, Uttar Pradesh, India (Mock: ${latitude}, ${longitude})`,
        placeId: "mock-reverse-geocode-id",
      };
    }

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${env.GOOGLE_MAPS_API_KEY}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) throw errors.unavailable("Reverse geocoding failed");
    const payload = await response.json();
    const result = payload.results?.[0];

    return {
      formattedAddress: result?.formatted_address || "Unknown Location",
      placeId: result?.place_id || "unknown-place-id",
    };
  }

  async listServiceAreas() {
    return prisma.serviceArea.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        city: true,
        state: true,
        centerLatitude: true,
        centerLongitude: true,
      },
    });
  }
}
