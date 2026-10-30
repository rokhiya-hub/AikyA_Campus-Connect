// The Vite command gate also excludes builds made with NODE_ENV=development.
// There is no simulator API or production/preview simulation capability.
export const simulationAllowed = __AIKYA_DEV_SERVER__ && import.meta.env.DEV && import.meta.env.VITE_BUS_TRACKING_SIMULATION === "true";
