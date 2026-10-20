export interface TilePublisher {
  publishServer(serverId: string, changedFiles?: string[]): Promise<void>;
}
