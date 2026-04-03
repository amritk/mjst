export type MessageBindingsObjectObject = {
  amqp?: unknown & ({ bindingVersion: "0.3.0" }) & BindingsAmqpMessageObject;
  amqp1?: unknown;
  anypointmq?: unknown & ({ bindingVersion: "0.0.1" }) & BindingsAnypointmqMessageObject;
  googlepubsub?: unknown & ({ bindingVersion: "0.2.0" }) & BindingsGooglepubsubMessageObject;
  http?: unknown & ({ bindingVersion: "0.2.0" }) & BindingsHttpMessageObject & ({ bindingVersion: "0.3.0" }) & BindingsHttpMessageObject;
  ibmmq?: unknown & ({ bindingVersion: "0.1.0" }) & BindingsIbmmqMessageObject;
  jms?: unknown & ({ bindingVersion: "0.0.1" }) & BindingsJmsMessageObject;
  kafka?: unknown & ({ bindingVersion: "0.5.0" }) & BindingsKafkaMessageObject & ({ bindingVersion: "0.4.0" }) & BindingsKafkaMessageObject & ({ bindingVersion: "0.3.0" }) & BindingsKafkaMessageObject;
  mqtt?: unknown & ({ bindingVersion: "0.2.0" }) & BindingsMqttMessageObject;
  nats?: unknown;
  redis?: unknown;
  sns?: unknown;
  solace?: unknown;
  sqs?: unknown;
  stomp?: unknown;
  ws?: unknown;
};