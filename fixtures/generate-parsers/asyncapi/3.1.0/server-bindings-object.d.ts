import type { BindingsIbmmq010ServerObject } from './bindings-ibmmq-0-1-0-server';
import type { BindingsJms001ServerObject } from './bindings-jms-0-0-1-server';
import type { BindingsKafka030ServerObject } from './bindings-kafka-0-3-0-server';
import type { BindingsKafka040ServerObject } from './bindings-kafka-0-4-0-server';
import type { BindingsKafka050ServerObject } from './bindings-kafka-0-5-0-server';
import type { BindingsMqtt020ServerObject } from './bindings-mqtt-0-2-0-server';
import type { BindingsPulsar010ServerObject } from './bindings-pulsar-0-1-0-server';
import type { BindingsRos2010ServerObject } from './bindings-ros2-0-1-0-server';
import type { BindingsSolace020ServerObject } from './bindings-solace-0-2-0-server';
import type { BindingsSolace030ServerObject } from './bindings-solace-0-3-0-server';
import type { BindingsSolace040ServerObject } from './bindings-solace-0-4-0-server';
export type ServerBindingsObjectObject = {
    amqp?: unknown;
    amqp1?: unknown;
    anypointmq?: unknown;
    googlepubsub?: unknown;
    http?: unknown;
    ibmmq?: unknown & ({
        bindingVersion: "0.1.0";
    }) & BindingsIbmmq010ServerObject;
    jms?: unknown & ({
        bindingVersion: "0.0.1";
    }) & BindingsJms001ServerObject;
    kafka?: unknown & ({
        bindingVersion: "0.5.0";
    }) & BindingsKafka050ServerObject & ({
        bindingVersion: "0.4.0";
    }) & BindingsKafka040ServerObject & ({
        bindingVersion: "0.3.0";
    }) & BindingsKafka030ServerObject;
    mqtt?: unknown & ({
        bindingVersion: "0.2.0";
    }) & BindingsMqtt020ServerObject;
    nats?: unknown;
    pulsar?: unknown & ({
        bindingVersion: "0.1.0";
    }) & BindingsPulsar010ServerObject;
    redis?: unknown;
    ros2?: unknown & ({
        bindingVersion: "0.1.0";
    }) & BindingsRos2010ServerObject;
    sns?: unknown;
    solace?: unknown & ({
        bindingVersion: "0.4.0";
    }) & BindingsSolace040ServerObject & ({
        bindingVersion: "0.3.0";
    }) & BindingsSolace030ServerObject & ({
        bindingVersion: "0.2.0";
    }) & BindingsSolace020ServerObject;
    sqs?: unknown;
    stomp?: unknown;
    ws?: unknown;
};
