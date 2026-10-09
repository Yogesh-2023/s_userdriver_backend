import type { FastifyPluginAsync } from "fastify";
import { LocationsController } from "./locations.controller";

export const locationRoutes: FastifyPluginAsync = async (fastify) => {
  const controller = new LocationsController();

  fastify.get("/states", controller.getStates.bind(controller));
  fastify.get(
    "/states/:stateCode/cities",
    controller.getCities.bind(controller),
  );
  fastify.get("/pincodes/:pincode", controller.getPincode.bind(controller));
};
