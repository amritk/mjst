export type OperationBindingsObjectObject = {
    amqp?: unknown & ({
        bindingVersion: "0.3.0";
    }) & BindingsAmqpOperationObject;
    amqp1?: unknown;
    anypointmq?: unknown;
    googlepubsub?: unknown;
    http?: unknown & ({
        bindingVersion: "0.2.0";
    }) & BindingsHttpOperationObject & ({
        bindingVersion: "0.3.0";
    }) & BindingsHttpOperationObject;
    ibmmq?: unknown;
    jms?: unknown;
    kafka?: unknown & ({
        bindingVersion: "0.5.0";
    }) & BindingsKafkaOperationObject & ({
        bindingVersion: "0.4.0";
    }) & BindingsKafkaOperationObject & ({
        bindingVersion: "0.3.0";
    }) & BindingsKafkaOperationObject;
    mqtt?: unknown & ({
        bindingVersion: "0.2.0";
    }) & BindingsMqttOperationObject;
    nats?: unknown & ({
        bindingVersion: "0.1.0";
    }) & BindingsNatsOperationObject;
    redis?: unknown;
    ros2?: unknown & ({
        bindingVersion: "0.1.0";
    }) & BindingsRos2OperationObject;
    sns?: unknown & ({
        bindingVersion: "0.1.0";
    }) & BindingsSnsOperationObject;
    solace?: unknown & ({
        bindingVersion: "0.4.0";
    }) & BindingsSolaceOperationObject & ({
        bindingVersion: "0.3.0";
    }) & BindingsSolaceOperationObject & ({
        bindingVersion: "0.2.0";
    }) & BindingsSolaceOperationObject;
    sqs?: unknown & ({
        bindingVersion: "0.2.0";
    }) & BindingsSqsOperationObject;
    stomp?: unknown;
    ws?: unknown;
};
