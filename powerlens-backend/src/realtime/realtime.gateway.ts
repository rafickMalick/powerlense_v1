import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

type ProviderSwitchPayload = { mode: 'mqtt' | 'simulator'; reason: string };

/**
 * Passerelle WebSocket temps réel.
 *
 * Diffuse vers les clients (frontend) les nouvelles mesures, alertes et
 * changements d'état des circuits dès qu'ils sont produits par le flux
 * MQTT/moteur de règles. Ces données ne sont jamais relues depuis
 * PostgreSQL pour le temps réel : PostgreSQL ne sert que d'historique.
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  // Dernier mode connu (mis à jour à chaque emitProviderSwitch) — permet à
  // un client qui se (re)connecte APRÈS la bascule initiale (ex: reload de
  // l'app, reconnexion réseau) de connaître immédiatement l'état courant au
  // lieu d'attendre indéfiniment une future transition qui n'arrivera peut-
  // être plus (cf. ProviderSwitcherService : ne réémet que sur changement).
  private lastProviderMode: ProviderSwitchPayload = { mode: 'simulator', reason: 'startup' };

  handleConnection(client: Socket) {
    client.emit('provider:switched', this.lastProviderMode);
  }

  emitMeasurement(payload: unknown) {
    this.server?.emit('measurement', payload);
  }

  emitAlert(payload: unknown) {
    this.server?.emit('alert', payload);
  }

  emitCircuitStatus(payload: unknown) {
    this.server?.emit('circuit:status', payload);
  }

  emitProviderSwitch(payload: ProviderSwitchPayload) {
    this.lastProviderMode = payload;
    this.server?.emit('provider:switched', payload);
  }

  // Présence matérielle d'un device (LWT MQTT). Émis dès réception d'un message
  // retenu sur `powerlens/+/+/status` — détection immédiate de la déconnexion,
  // sans attendre le silence des mesures (ESP_TIMEOUT_MS).
  emitDeviceStatus(payload: {
    buildingId?: string;
    deviceUid?: string;
    online: boolean;
    at: string;
  }) {
    this.server?.emit('device:status', payload);
  }
}
