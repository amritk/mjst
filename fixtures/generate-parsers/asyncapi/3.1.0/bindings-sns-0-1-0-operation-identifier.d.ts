export type BindingsSns010OperationIdentifierObject = {
    /** The endpoint is a URL. */
    url?: string;
    /** The endpoint is an email address. */
    email?: string;
    /** The endpoint is a phone number. */
    phone?: string;
    /** The target is an ARN. For example, for SQS, the identifier may be an ARN, which will be of the form: arn:aws:sqs:{region}:{account-id}:{queueName} */
    arn?: string;
    /** The endpoint is identified by a name, which corresponds to an identifying field called 'name' of a binding for that protocol on this publish Operation Object. For example, if the protocol is 'sqs' then the name refers to the name field sqs binding. We don't use $ref because we are referring, not including. */
    name?: string;
};
