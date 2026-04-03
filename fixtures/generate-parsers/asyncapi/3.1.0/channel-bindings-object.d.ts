import type { BindingsAmqp030ChannelObject } from './bindings-amqp-0-3-0-channel';
import type { BindingsAnypointmq001ChannelObject } from './bindings-anypointmq-0-0-1-channel';
import type { BindingsGooglepubsub020ChannelObject } from './bindings-googlepubsub-0-2-0-channel';
import type { BindingsIbmmq010ChannelObject } from './bindings-ibmmq-0-1-0-channel';
import type { BindingsJms001ChannelObject } from './bindings-jms-0-0-1-channel';
import type { BindingsKafka030ChannelObject } from './bindings-kafka-0-3-0-channel';
import type { BindingsKafka040ChannelObject } from './bindings-kafka-0-4-0-channel';
import type { BindingsKafka050ChannelObject } from './bindings-kafka-0-5-0-channel';
import type { BindingsPulsar010ChannelObject } from './bindings-pulsar-0-1-0-channel';
import type { BindingsSns010ChannelObject } from './bindings-sns-0-1-0-channel';
import type { BindingsSqs020ChannelObject } from './bindings-sqs-0-2-0-channel';
import type { BindingsWebsockets010ChannelObject } from './bindings-websockets-0-1-0-channel';
export type ChannelBindingsObjectObject = {
    amqp?: unknown & ({
        bindingVersion: "0.3.0";
    }) & BindingsAmqp030ChannelObject;
    amqp1?: unknown;
    anypointmq?: unknown & ({
        bindingVersion: "0.0.1";
    }) & BindingsAnypointmq001ChannelObject;
    googlepubsub?: unknown & ({
        bindingVersion: "0.2.0";
    }) & BindingsGooglepubsub020ChannelObject;
    http?: unknown;
    ibmmq?: unknown & ({
        bindingVersion: "0.1.0";
    }) & BindingsIbmmq010ChannelObject;
    jms?: unknown & ({
        bindingVersion: "0.0.1";
    }) & BindingsJms001ChannelObject;
    kafka?: unknown & ({
        bindingVersion: "0.5.0";
    }) & BindingsKafka050ChannelObject & ({
        bindingVersion: "0.4.0";
    }) & BindingsKafka040ChannelObject & ({
        bindingVersion: "0.3.0";
    }) & BindingsKafka030ChannelObject;
    mqtt?: unknown;
    nats?: unknown;
    pulsar?: unknown & ({
        bindingVersion: "0.1.0";
    }) & BindingsPulsar010ChannelObject;
    redis?: unknown;
    sns?: unknown & ({
        bindingVersion: "0.1.0";
    }) & BindingsSns010ChannelObject;
    solace?: unknown;
    sqs?: unknown & ({
        bindingVersion: "0.2.0";
    }) & BindingsSqs020ChannelObject;
    stomp?: unknown;
    ws?: unknown & ({
        bindingVersion: "0.1.0";
    }) & BindingsWebsockets010ChannelObject;
};
