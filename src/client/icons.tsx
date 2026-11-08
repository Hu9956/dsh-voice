/**
 * 喇叭图标：off 带叉，on 带声波，stop 是方块。
 * 照官方 *OutlineRegular 的画法：16 格、空心线条、线宽 1、圆头圆角，和回复下面的复制、点赞、分享一致。
 * 官方图标库里没有喇叭，所以是自己画的；停止沿用官方 StopFill 的实心方块。
 * 外框照官方的占位：横向 1.5–14.5、纵向约 2–14，否则看着比旁边的图标小。
 */
export function SpeakerIcon({ mode, size = 16 }: { mode: 'off' | 'on' | 'stop', size?: number }) {
  if (mode === 'stop') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.5 6.5a1 1 0 0 1 1-1h2l3.2-3.1c.3-.3.8-.1.8.4v10.4c0 .5-.5.7-.8.4L4.5 10.5h-2a1 1 0 0 1-1-1z" />
      {mode === 'on'
        ? (
            <>
              <path d="M10.8 5.6a3.4 3.4 0 0 1 0 4.8" />
              <path d="M12.6 3.4a6.5 6.5 0 0 1 0 9.2" />
            </>
          )
        : <path d="M10.8 6.2l3.6 3.6M14.4 6.2l-3.6 3.6" />}
    </svg>
  )
}

/** 电话听筒。hangup 时转 135 度（挂断）。 */
export function PhoneIcon({ hangup = false, size = 16 }: { hangup?: boolean, size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={hangup ? { transform: 'rotate(135deg)' } : undefined}>
      <path
        fill="currentColor"
        d="M4.2 1.6c.4-.2.9 0 1.1.4l1.2 2.4c.2.4.1.8-.2 1.1l-.9.8c.6 1.4 1.7 2.6 3.2 3.3l.8-.9c.3-.3.8-.4 1.1-.2l2.4 1.2c.4.2.6.7.4 1.1l-.6 1.6c-.2.6-.8.9-1.4.9C6 13.1 2.9 10 2.7 4.2c0-.6.3-1.2.9-1.4z"
      />
    </svg>
  )
}

/** 麦克风斜杠（静音）。 */
export function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <rect x="5.5" y="1.8" width="5" height="8" rx="2.5" fill={muted ? 'none' : 'currentColor'} stroke={muted ? 'currentColor' : 'none'} />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.2" />
      {muted && <path d="M2.5 2.5l11 11" />}
    </svg>
  )
}
