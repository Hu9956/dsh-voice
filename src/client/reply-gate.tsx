import { createElement, type ComponentType } from 'react'
import { useSettings } from './settings'

/** Disable the whole output/call component tree so its effects are disposed. */
export function withReplyEnabled<P extends object>(Component: ComponentType<P>): ComponentType<P> {
  return function ReplyGate(props: P) {
    const { view } = useSettings()
    return view?.settings.replyEnabled === false ? null : createElement(Component, props)
  }
}
