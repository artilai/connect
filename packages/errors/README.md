# @artil/errors

The error codes, HTTP statuses and error body shared by the API and its
clients.

## Usage

`@artil/errors` exports `AppError`, `errorBodySchema` and
`receivedErrorBodySchema`. Throw an `AppError` with a code such as `not_found`
or `forbidden`; the API turns it into the matching status and a
`{ error: { code, message } }` body, and clients parse that body back into an
`AppError` with `receivedErrorBodySchema`, which reads codes they do not know as
`internal`.
