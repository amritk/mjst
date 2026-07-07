import { codeClimate } from './code-climate'
import type { Formatter } from './common'

// GitLab Code Quality consumes the Code Climate report format verbatim, so this
// is an alias rather than a separate implementation.
export const gitlab: Formatter = codeClimate
