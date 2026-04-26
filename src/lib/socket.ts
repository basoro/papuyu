import { io, type ManagerOptions, type Socket, type SocketOptions } from "socket.io-client";
import { API_URL } from "./api";

type SocketConfig = Partial<ManagerOptions & SocketOptions>;

// Default to long-polling because some deployments proxy REST correctly
// but do not forward WebSocket upgrades on /socket.io.
const defaultSocketOptions: Partial<ManagerOptions & SocketOptions> = {
  transports: ["polling"],
  upgrade: false,
  reconnectionAttempts: 5,
};

export function createPapuyuSocket(options: SocketConfig = {}): Socket {
  return io(API_URL, {
    ...defaultSocketOptions,
    ...options,
  });
}
