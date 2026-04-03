export type ServerBindingsObjectObject = {
    amqp?: unknown;
    amqp1?: unknown;
    anypointmq?: unknown;
    googlepubsub?: unknown;
    http?: unknown;
    ibmmq?: unknown & ({
        bindingVersion: "0.1.0";
    }) & BindingsIbmmqServerObject;
    jms?: unknown & ({
        bindingVersion: "0.0.1";
    }) & BindingsJmsServerObject;
    kafka?: unknown & ({
        bindingVersion: "0.5.0";
    }) & BindingsKafkaServerObject & ({
        bindingVersion: "0.4.0";
    }) & BindingsKafkaServerObject & ({
        bindingVersion: "0.3.0";
    }) & BindingsKafkaServerObject;
    mqtt?: unknown & ({
        bindingVersion: "0.2.0";
    }) & BindingsMqttServerObject;
    nats?: unknown;
    pulsar?: unknown & ({
        bindingVersion: "0.1.0";
    }) & BindingsPulsarServerObject;
    redis?: unknown;
    ros2?: unknown & ({
        bindingVersion: "0.1.0";
    }) & BindingsRos2ServerObject;
    sns?: unknown;
    solace?: unknown & ({
        bindingVersion: "0.4.0";
    }) & BindingsSolaceServerObject & ({
        bindingVersion: "0.3.0";
    }) & BindingsSolaceServerObject & ({
        bindingVersion: "0.2.0";
    }) & BindingsSolaceServerObject;
    sqs?: unknown;
    stomp?: unknown;
    ws?: unknown;
};
