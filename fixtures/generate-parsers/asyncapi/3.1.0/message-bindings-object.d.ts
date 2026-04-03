import type { BindingsAmqp030MessageObject } from './bindings-amqp-0-3-0-message';
import type { BindingsAnypointmq001MessageObject } from './bindings-anypointmq-0-0-1-message';
import type { BindingsGooglepubsub020MessageObject } from './bindings-googlepubsub-0-2-0-message';
import type { BindingsHttp020MessageObject } from './bindings-http-0-2-0-message';
import type { BindingsHttp030MessageObject } from './bindings-http-0-3-0-message';
import type { BindingsIbmmq010MessageObject } from './bindings-ibmmq-0-1-0-message';
import type { BindingsJms001MessageObject } from './bindings-jms-0-0-1-message';
import type { BindingsKafka030MessageObject } from './bindings-kafka-0-3-0-message';
import type { BindingsKafka040MessageObject } from './bindings-kafka-0-4-0-message';
import type { BindingsKafka050MessageObject } from './bindings-kafka-0-5-0-message';
import type { BindingsMqtt020MessageObject } from './bindings-mqtt-0-2-0-message';
export type MessageBindingsObjectObject = {
    amqp?: unknown & ({
        bindingVersion: "0.3.0";
    }) & BindingsAmqp030MessageObject;
    amqp1?: unknown;
    anypointmq?: unknown & ({
        bindingVersion: "0.0.1";
    }) & BindingsAnypointmq001MessageObject;
    googlepubsub?: unknown & ({
        bindingVersion: "0.2.0";
    }) & BindingsGooglepubsub020MessageObject;
    http?: unknown & ({
        bindingVersion: "0.2.0";
    }) & BindingsHttp020MessageObject & ({
        bindingVersion: "0.3.0";
    }) & BindingsHttp030MessageObject;
    ibmmq?: unknown & ({
        bindingVersion: "0.1.0";
    }) & BindingsIbmmq010MessageObject;
    jms?: unknown & ({
        bindingVersion: "0.0.1";
    }) & BindingsJms001MessageObject;
    kafka?: unknown & ({
        bindingVersion: "0.5.0";
    }) & BindingsKafka050MessageObject & ({
        bindingVersion: "0.4.0";
    }) & BindingsKafka040MessageObject & ({
        bindingVersion: "0.3.0";
    }) & BindingsKafka030MessageObject;
    mqtt?: unknown & ({
        bindingVersion: "0.2.0";
    }) & BindingsMqtt020MessageObject;
    nats?: unknown;
    redis?: unknown;
    sns?: unknown;
    solace?: unknown;
    sqs?: unknown;
    stomp?: unknown;
    ws?: unknown;
};
