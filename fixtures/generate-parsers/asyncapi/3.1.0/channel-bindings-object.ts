export type ChannelBindingsObjectObject = {
  amqp?: unknown & ({ bindingVersion: "0.3.0" }) & BindingsAmqpChannelObject;
  amqp1?: unknown;
  anypointmq?: unknown & ({ bindingVersion: "0.0.1" }) & BindingsAnypointmqChannelObject;
  googlepubsub?: unknown & ({ bindingVersion: "0.2.0" }) & BindingsGooglepubsubChannelObject;
  http?: unknown;
  ibmmq?: unknown & ({ bindingVersion: "0.1.0" }) & BindingsIbmmqChannelObject;
  jms?: unknown & ({ bindingVersion: "0.0.1" }) & BindingsJmsChannelObject;
  kafka?: unknown & ({ bindingVersion: "0.5.0" }) & BindingsKafkaChannelObject & ({ bindingVersion: "0.4.0" }) & BindingsKafkaChannelObject & ({ bindingVersion: "0.3.0" }) & BindingsKafkaChannelObject;
  mqtt?: unknown;
  nats?: unknown;
  pulsar?: unknown & ({ bindingVersion: "0.1.0" }) & BindingsPulsarChannelObject;
  redis?: unknown;
  sns?: unknown & ({ bindingVersion: "0.1.0" }) & BindingsSnsChannelObject;
  solace?: unknown;
  sqs?: unknown & ({ bindingVersion: "0.2.0" }) & BindingsSqsChannelObject;
  stomp?: unknown;
  ws?: unknown & ({ bindingVersion: "0.1.0" }) & BindingsWebsocketsChannelObject;
};