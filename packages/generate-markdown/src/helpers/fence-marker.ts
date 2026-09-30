/**
 * The run of backticks or tildes a line opens or closes a fenced block with,
 * or undefined for a line that is not a fence. Shared by everything that has
 * to know where a code sample starts, so a paragraph split and a step list
 * cannot disagree about which lines are code.
 */
export const fenceMarker = (line: string): string | undefined => /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
