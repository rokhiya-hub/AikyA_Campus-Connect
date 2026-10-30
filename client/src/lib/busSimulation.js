// Arbitrary positions near (0,0), deliberately unrelated to campus or actual routes.
// Only the development UI consumes this fixture; never POST it to the server.
export function simulatedBus(tick) {
  return { busId: "simulation-only", tripId: "simulation-only", routeNumber: "SIMULATED", vehicleLabel: "Development fixture — not a real bus", stops: [],
    trackingStatus: "simulated", recordedAt: new Date().toISOString(), receivedAt: new Date().toISOString(),
    location: { latitude: 0.001 + (tick % 20) * 0.00001, longitude: 0.001, accuracy: 25 }, eta: { available: false, reason: "Simulation is not real tracking" } };
}
