import type { FastifyRequest, FastifyReply } from "fastify";
import { State, City } from "country-state-city";
import { success } from "../../common/response";
import { parse } from "../../common/validation";
import * as schemas from "./locations.validation";
import { errors } from "../../common/errors";

export class LocationsController {
  async getStates(req: FastifyRequest, reply: FastifyReply) {
    const states = State.getStatesOfCountry("IN").map((s) => ({
      name: s.name,
      isoCode: s.isoCode,
    }));
    return reply.send(success(states));
  }

  async getCities(req: FastifyRequest, reply: FastifyReply) {
    const { stateCode } = parse(schemas.getCitiesSchema, req.params);
    const cities = City.getCitiesOfState("IN", stateCode).map((c) => ({
      name: c.name,
    }));

    if (cities.length === 0) {
      throw errors.badRequest(
        "Invalid state code or no cities found for this state",
      );
    }

    return reply.send(success(cities));
  }

  async getPincode(req: FastifyRequest, reply: FastifyReply) {
    const { pincode } = parse(schemas.getPincodeSchema, req.params);

    try {
      const response = await fetch(
        `https://api.postalpincode.in/pincode/${pincode}`,
      );
      if (!response.ok) {
        throw new Error("Failed to fetch from Postal API");
      }

      const data = await response.json();

      if (!data || data.length === 0 || data[0].Status !== "Success") {
        throw errors.badRequest("Invalid pincode or details not found");
      }

      const postOffices = data[0].PostOffice;
      if (!postOffices || postOffices.length === 0) {
        throw errors.badRequest("No post office data found for this pincode");
      }

      // Use the first post office to get the state and city/district
      const po = postOffices[0];
      const result = {
        state: po.State,
        city: po.District || po.Block || po.Region,
      };

      return reply.send(success(result));
    } catch (error) {
      if ((error as any).statusCode) {
        throw error;
      }
      throw new Error("Failed to fetch pincode details");
    }
  }
}
