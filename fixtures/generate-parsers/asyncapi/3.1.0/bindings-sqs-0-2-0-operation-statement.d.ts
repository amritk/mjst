export type BindingsSqs020OperationStatementObject = {
    effect: "Allow" | "Deny";
    /** The AWS account or resource ARN that this statement applies to. */
    principal: string | string[];
    /** The SQS permission being allowed or denied e.g. sqs:ReceiveMessage */
    action: string | string[];
};
