import { env } from "../config/env";

export interface VehicleRcDetails {
  registrationNo: string;
  makerName: string;
  modelName: string;
  vehicleClass: string;
  fuelType: string;
  registrationDate: string;
  insuranceValidTill: string | null;
  seatingCapacity: number;
}

export interface RtoProvider {
  fetchVehicleDetails(registrationNo: string): Promise<VehicleRcDetails | null>;
}

/**
 * A Production-Grade Mock RTO Provider that simulates fetching RC details
 * from a real VAHAN API (like Karza or SurePass).
 *
 * In a real-world scenario, you would implement `SurepassRtoProvider`
 * that makes HTTP requests to `https://kyc-api.surepass.io/api/v1/rc/rc-full`
 */
export class MockRtoProvider implements RtoProvider {
  async fetchVehicleDetails(
    registrationNo: string,
  ): Promise<VehicleRcDetails | null> {
    const regNo = registrationNo.toUpperCase().replace(/\s+/g, "");

    console.log("Fetching RC details from RTO API...", { regNo });

    // Mock API delay
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Simulate different vehicle classes based on common test license plates
    // We can use the last digit of the registration number to determine the class for testing
    const lastDigit = parseInt(regNo.slice(-1), 10);
    let vehicleClass = "MOTOR CAR";
    let makerName = "MARUTI SUZUKI INDIA LTD";
    let modelName = "SWIFT DZIRE";
    let seatingCapacity = 4;
    let fuelType = "PETROL";

    if (isNaN(lastDigit)) {
      // Default to MOTOR CAR if no digits
    } else if (lastDigit === 1 || lastDigit === 2) {
      vehicleClass = "M-CYCLE/SCOOTER(2WN)";
      makerName = "HERO MOTOCORP LTD";
      modelName = "SPLENDOR PLUS";
      seatingCapacity = 2;
    } else if (lastDigit === 3 || lastDigit === 4) {
      vehicleClass = "THREE WHEELER (PASSENGER)";
      makerName = "BAJAJ AUTO LTD";
      modelName = "RE COMPACT 4S";
      seatingCapacity = 3;
      fuelType = "CNG";
    } else if (lastDigit === 5 || lastDigit === 6) {
      vehicleClass = "MOTOR CAR";
      makerName = "TATA MOTORS LTD";
      modelName = "TIAGO";
      seatingCapacity = 4;
    } else if (lastDigit === 7 || lastDigit === 8) {
      vehicleClass = "MOTOR CAR";
      makerName = "TOYOTA KIRLOSKAR MOTOR PVT LTD";
      modelName = "INNOVA CRYSTA";
      seatingCapacity = 6;
      fuelType = "DIESEL";
    } else if (lastDigit === 9 || lastDigit === 0) {
      // Sometimes APIs return generic types
      vehicleClass = "E-RICKSHAW(P)";
      makerName = "MAHINDRA ELECTRIC";
      modelName = "TREO";
      seatingCapacity = 4;
      fuelType = "ELECTRIC";
    }

    return {
      registrationNo: regNo,
      makerName,
      modelName,
      vehicleClass,
      fuelType,
      registrationDate: "2020-05-12",
      insuranceValidTill: "2028-05-12",
      seatingCapacity,
    };
  }
}

// Map VAHAN vehicle classes to our internal DB slugs
export function mapRtoClassToCategorySlug(
  vehicleClass: string,
  seatingCapacity: number = 4,
): string {
  const vClass = vehicleClass.toUpperCase();

  if (
    vClass.includes("M-CYCLE") ||
    vClass.includes("SCOOTER") ||
    vClass.includes("MOTOR CYCLE")
  ) {
    return "bike";
  }

  if (
    vClass.includes("THREE WHEELER") ||
    vClass.includes("AUTO") ||
    vClass.includes("E-RICKSHAW")
  ) {
    return "auto";
  }

  if (vClass.includes("MOTOR CAB") || vClass.includes("MOTOR CAR")) {
    if (seatingCapacity >= 6) return "muv-xl"; // Innova, Ertiga
    if (seatingCapacity === 5 || seatingCapacity === 4) {
      // Simple heuristic: we can't reliably tell hatchback from sedan just from class
      // In a real API, we'd look at model name or cubic capacity
      return "hatchback";
    }
    return "hatchback";
  }

  if (vClass.includes("GOODS CARRIER") || vClass.includes("PARCEL")) {
    return "parcel";
  }

  return "hatchback"; // Default safe fallback
}

// Export singleton instance
export const rtoService = new MockRtoProvider();
