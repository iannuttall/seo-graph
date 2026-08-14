import { agentMarkdownMiddleware } from './middleware.js'

/** Default middleware used by `agentMarkdown({ runtimeMiddleware: true })`. */
export const onRequest = agentMarkdownMiddleware({ contentNegotiation: true })
