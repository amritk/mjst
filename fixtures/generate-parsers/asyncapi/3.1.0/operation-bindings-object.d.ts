import type { BindingsAmqp030OperationObject } from './bindings-amqp-0-3-0-operation';
import type { BindingsHttp020OperationObject } from './bindings-http-0-2-0-operation';
import type { BindingsHttp030OperationObject } from './bindings-http-0-3-0-operation';
import type { BindingsKafka030OperationObject } from './bindings-kafka-0-3-0-operation';
import type { BindingsKafka040OperationObject } from './bindings-kafka-0-4-0-operation';
import type { BindingsKafka050OperationObject } from './bindings-kafka-0-5-0-operation';
import type { BindingsMqtt020OperationObject } from './bindings-mqtt-0-2-0-operation';
import type { BindingsNats010OperationObject } from './bindings-nats-0-1-0-operation';
import type { BindingsRos2010OperationObject } from './bindings-ros2-0-1-0-operation';
import type { BindingsSns010OperationObject } from './bindings-sns-0-1-0-operation';
import type { BindingsSolace020OperationObject } from './bindings-solace-0-2-0-operation';
import type { BindingsSolace030OperationObject } from './bindings-solace-0-3-0-operation';
import type { BindingsSolace040OperationObject } from './bindings-solace-0-4-0-operation';
import type { BindingsSqs020OperationObject } from './bindings-sqs-0-2-0-operation';
export type OperationBindingsObjectObject = {
    amqp?: unknown & ({
        bindingVersion: "0.3.0";
    }) & BindingsAmqp030OperationObject;
    amqp1?: unknown;
    anypointmq?: unknown;
    googlepubsub?: unknown;
    http?: unknown & ({
        bindingVersion: "0.2.0";
    }) & BindingsHttp020OperationObject & ({
        bindingVersion: "0.3.0";
    }) & BindingsHttp030OperationObject;
    ibmmq?: unknown;
    jms?: unknown;
    kafka?: unknown & ({
        bindingVersion: "0.5.0";
    }) & BindingsKafka050OperationObject & ({
        bindingVersion: "0.4.0";
    }) & BindingsKafka040OperationObject & ({
        bindingVersion: "0.3.0";
    }) & BindingsKafka030OperationObject;
    mqtt?: unknown & ({
        bindingVersion: "0.2.0";
    }) & BindingsMqtt020OperationObject;
    nats?: unknown & ({
        bindingVersion: "0.1.0";
    }) & BindingsNats010OperationObject;
    redis?: unknown;
    ros2?: unknown & ({
        bindingVersion: "0.1.0";
    }) & BindingsRos2010OperationObject;
    sns?: unknown & ({
        bindingVersion: "0.1.0";
    }) & BindingsSns010OperationObject;
    solace?: unknown & ({
        bindingVersion: "0.4.0";
    }) & BindingsSolace040OperationObject & ({
        bindingVersion: "0.3.0";
    }) & BindingsSolace030OperationObject & ({
        bindingVersion: "0.2.0";
    }) & BindingsSolace020OperationObject;
    sqs?: unknown & ({
        bindingVersion: "0.2.0";
    }) & BindingsSqs020OperationObject;
    stomp?: unknown;
    ws?: unknown;
};
