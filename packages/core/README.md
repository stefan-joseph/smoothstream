# @smoothstream/core

Framework-neutral Markdown analysis, stabilization, and reveal scheduling for
Smoothstream adapters. Most application users should install a renderer such as
`@smoothstream/react`, `@smoothstream/vue`, or `@smoothstream/dom` instead.

Web renderer adapters share the SSR-safe `@smoothstream/core/web` subpath. It
projects core presentation snapshots into keyed HTML records without importing
a framework or accessing browser globals. This is an adapter-facing API rather
than the usual application entry point.
