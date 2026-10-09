/**
 * Vehicle verification review helpers.
 *
 * These compute an honest, document-backed review of whether a vehicle's
 * registered details match the (manually recorded) document metadata that the
 * driver uploaded. There is no OCR in the system, so the only authoritative
 * document source is the `documentNo` stored at upload time.
 */

export const VEHICLE_NUMBER_DOC_TYPES = [
  "REGISTRATION_CERTIFICATE",
  "RC",
  "VEHICLE_REGISTRATION",
];

/**
 * Normalize a vehicle registration number so that formatting differences
 * (case, spaces, hyphens, dots) do not cause false mismatches.
 */
export function normalizeVehicleNumber(value: string | null | undefined): string {
  return (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export type MatchResult = "MATCHED" | "MISMATCH" | "UNABLE";

export interface VehicleVerificationReview {
  vehicleNumber: {
    master: string | null;
    document: string | null;
    source: string | null;
    result: MatchResult;
  };
  vehicleModel: {
    master: string | null;
    document: string | null;
    source: string | null;
    result: MatchResult;
  };
}

/**
 * Build a review for a vehicle from its uploaded document metadata.
 *
 * - Vehicle number: compared against the REGISTRATION_CERTIFICATE / RC
 *   document `documentNo` when one is recorded. Missing metadata yields
 *   `UNABLE` (we never fabricate document values).
 * - Vehicle model: the system has no document field that records the model,
 *   so it is always `UNABLE` unless the master value itself is missing.
 */
export function buildVehicleReview(vehicle: {
  registrationNo?: string | null;
  make?: string | null;
  model?: string | null;
  documents?: Array<{ type: string; documentNo?: string | null }>;
}): VehicleVerificationReview {
  const documents = vehicle.documents ?? [];
  const rcDoc = documents.find((doc) =>
    VEHICLE_NUMBER_DOC_TYPES.includes(doc.type),
  );

  const masterNumber = vehicle.registrationNo ?? null;
  const docNumber = rcDoc?.documentNo ?? null;

  let numberResult: MatchResult = "UNABLE";
  if (masterNumber && docNumber) {
    numberResult =
      normalizeVehicleNumber(masterNumber) === normalizeVehicleNumber(docNumber)
        ? "MATCHED"
        : "MISMATCH";
  }

  const masterModel = [vehicle.make, vehicle.model]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    vehicleNumber: {
      master: masterNumber,
      document: docNumber,
      source: rcDoc?.type ?? null,
      result: numberResult,
    },
    vehicleModel: {
      master: masterModel || null,
      document: null,
      source: null,
      result: masterModel ? "UNABLE" : "UNABLE",
    },
  };
}