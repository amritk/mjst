export type BindingsSns010ChannelStatementObject = {
    effect: "Allow" | "Deny";
    /** The AWS account or resource ARN that this statement applies to. */
    principal: string | string[];
    /** The SNS permission being allowed or denied e.g. sns:Publish */
    action: string | string[];
};
