import { authBasePath, SignInBody, SignInResult, signInWording, SignOutResult } from "@flockr/contracts"
import { forbidden } from "../board/errors"
import { jsonBody, ok, operation, router } from "./shared"

const tags: [string] = ["auth"]
const signInOff = () => forbidden("Sign-in is off on this board (FLOCKR_AUTH=off); the x-flockr-member header names the member")

export const authRoutes = router()
  .openapi(
    operation({
      method: "post",
      path: `${authBasePath}/sign-in/magic-link`,
      operationId: "requestSignInLink",
      tags,
      summary: "Email a one-time sign-in link to a person on the board's list. Any other address gets the same answer and no email",
      request: { body: jsonBody(SignInBody) },
      responses: ok(SignInResult),
    }),
    async (c) => {
      if (c.var.auth.mode === "off") throw signInOff()
      const { email, callbackURL } = c.req.valid("json")
      await c.var.auth.betterAuth().api.signInMagicLink({ body: { email, callbackURL: callbackURL ?? "/" }, headers: c.req.raw.headers })
      return c.json({ status: true, message: signInWording.sent }, 200)
    },
  )
  .openapi(
    operation({
      method: "post",
      path: `${authBasePath}/sign-out`,
      operationId: "signOut",
      tags,
      summary: "End this browser's session; safe to repeat",
      responses: ok(SignOutResult),
    }),
    async (c) => {
      if (c.var.auth.mode === "off") throw signInOff()
      const { headers } = await c.var.auth.betterAuth().api.signOut({ headers: c.req.raw.headers, returnHeaders: true })
      for (const cookie of headers.getSetCookie()) c.header("set-cookie", cookie, { append: true })
      return c.json({ success: true }, 200)
    },
  )
