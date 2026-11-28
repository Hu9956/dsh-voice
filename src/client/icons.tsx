import {
  MicIcon as DshMicIcon,
  MicOffIcon as DshMicOffIcon,
  PhoneIcon as DshPhoneIcon,
  VolumeIcon,
  VolumeOffIcon,
} from '@kewen/dsh-ui'

/**
 * 喇叭图标：off → volume-x，on → volume-2（均来自 @kewen/dsh-ui 统一 24×24 图标）；
 * stop 保留私有实心小方块（比 Lucide square 更紧凑，像停止键）。
 */
export function SpeakerIcon({ mode, size = 16 }: { mode: 'off' | 'on' | 'stop', size?: number }) {
  if (mode === 'stop') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" />
      </svg>
    )
  }
  return mode === 'on'
    ? <VolumeIcon size={size} inline={false} />
    : <VolumeOffIcon size={size} inline={false} />
}

/** 电话听筒（实心）：hangup 时顺时针转 135 度表示挂断。 */
export function PhoneIcon({ hangup = false, size = 16 }: { hangup?: boolean, size?: number }) {
  return <DshPhoneIcon hangup={hangup} size={size} inline={false} />
}

/** 麦克风（静音态用 Lucide 原版斜线留白 mic-off）。 */
export function MicIcon({ muted, size = 16 }: { muted: boolean, size?: number }) {
  return muted
    ? <DshMicOffIcon size={size} inline={false} />
    : <DshMicIcon size={size} inline={false} />
}
