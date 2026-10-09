import { z } from "zod";

export const getCitiesSchema = z.object({
  stateCode: z.string().min(1).max(50),
});

export const getPincodeSchema = z.object({
  pincode: z.string().min(4).max(10),
});
