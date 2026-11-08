import { useEffect, useRef, useState } from 'react'
import { Mic, MicError } from './call/mic'
import { Vad, rmsDb, type Sensitivity } from './call/vad'
import { LevelHistory, SENSITIVITY_LABELS, adviceFor } from './call/noise-meter'

/** 测多久自动停。 */
const AUTO_STOP_MS = 60_000
/** 界面刷新间隔。 */
const TICK_MS = 150
/** 至少记这么久的音量再给建议。 */
const ADVICE_AFTER_MS = 2500
/** 音量条的范围（dBFS）。 */
const BAR_MIN_DB = -70
const BAR_MAX_DB = -10

interface Reading {
  levelDb: number
  floorDb: number | null
  /** 断句此刻实际用的门限（跟它自己的底噪估计走）。 */
  thresholdDb: number
  coveredMs: number
  speaking: boolean
  last: string
}

interface Run {
  mic: Mic
  vad: Vad
  history: LevelHistory
  timer: ReturnType<typeof setInterval>
  stopAt: number
  last: string
}

function asLevel(value: string): Sensitivity {
  return value in SENSITIVITY_LABELS ? value as Sensitivity : 'medium'
}

function barPercent(db: number): number {
  return Math.round(Math.min(1, Math.max(0, (db - BAR_MIN_DB) / (BAR_MAX_DB - BAR_MIN_DB))) * 100)
}

/**
 * 设置页「测一下环境噪声」：开麦克风，实时显示音量、环境底噪、现在这档的说话门限，
 * 以及断句认为你在说还是安静了。按选的档位和停顿时长判断，和通话里一致。
 */
export function NoiseMeter({ sensitivity, silenceMs }: { sensitivity: string, silenceMs: number }) {
  const run = useRef<Run | null>(null)
  const [reading, setReading] = useState<Reading | null>(null)
  const [error, setError] = useState<string | null>(null)
  const level = asLevel(sensitivity)

  const stop = () => {
    const r = run.current
    if (r === null) return
    run.current = null
    clearInterval(r.timer)
    r.mic.close()
    setReading(null)
  }

  // 测着的时候改档位、改停顿：马上按新的判断
  useEffect(() => {
    run.current?.vad.setSensitivity(level)
    run.current?.vad.setSilenceMs(silenceMs)
  }, [level, silenceMs])

  useEffect(() => stop, [])

  const start = () => {
    setError(null)
    // AudioContext 必须在点按里同步建好（手机上不然一直 suspended）
    const mic = Mic.create()
    if (mic === undefined) {
      setError('这个浏览器不能录音')
      return
    }
    const vad = new Vad({ sampleRate: mic.sampleRate, silenceMs })
    vad.setSensitivity(level)
    const history = new LevelHistory()
    const r: Run = {
      mic,
      vad,
      history,
      stopAt: performance.now() + AUTO_STOP_MS,
      last: '',
      timer: setInterval(() => {
        if (run.current !== r) return
        if (performance.now() >= r.stopAt) {
          stop()
          return
        }
        setReading({
          levelDb: r.vad.lastDb,
          floorDb: r.history.floorDb(),
          thresholdDb: r.vad.thresholdDb,
          coveredMs: r.history.coveredMs,
          speaking: r.vad.isSpeaking,
          last: r.last,
        })
      }, TICK_MS),
    }
    run.current = r
    setReading({ levelDb: BAR_MIN_DB, floorDb: null, thresholdDb: vad.thresholdDb, coveredMs: 0, speaking: false, last: '' })
    mic.open({
      audio(samples) {
        if (run.current !== r) return
        r.history.push(rmsDb(samples), samples.length / mic.sampleRate * 1000)
        for (const event of r.vad.push(samples)) {
          if (event.kind === 'end') r.last = `认出一句 ${(event.speechMs / 1000).toFixed(1)} 秒，通话里这时会发出去`
          else if (event.kind === 'discard') r.last = '刚才那下太短，当成杂音丢掉了'
        }
      },
      wantsAudio: () => true,
      lost(message) {
        if (run.current !== r) return
        stop()
        setError(message)
      },
    }).catch((e: unknown) => {
      if (run.current !== r) return
      stop()
      setError(e instanceof MicError ? e.message : `打不开麦克风：${e instanceof Error ? e.message : String(e)}`)
    })
  }

  const threshold = reading === null || reading.coveredMs < 300 ? null : reading.thresholdDb
  const ready = reading !== null && reading.floorDb !== null && reading.coveredMs >= ADVICE_AFTER_MS

  return (
    <div className="vr-meter">
      <div className="vr-settings-control">
        <button type="button" className="vr-settings-button" onClick={reading === null ? start : stop}>
          {reading === null ? '测一下环境噪声' : '停止'}
        </button>
        {reading !== null
          ? <span className="vr-settings-value" data-speaking={reading.speaking ? '' : undefined}>{reading.speaking ? '当成你在说话' : '安静'}</span>
          : null}
      </div>
      {reading !== null
        ? (
            <>
              <div className="vr-meter-bar" aria-hidden="true">
                <div className="vr-meter-fill" data-speaking={reading.speaking ? '' : undefined} style={{ width: `${barPercent(reading.levelDb)}%` }} />
                {reading.floorDb !== null ? <div className="vr-meter-mark" data-kind="floor" style={{ left: `${barPercent(reading.floorDb)}%` }} /> : null}
                {threshold !== null ? <div className="vr-meter-mark" data-kind="threshold" style={{ left: `${barPercent(threshold)}%` }} /> : null}
              </div>
              <p className="vr-settings-note">
                {`音量 ${Math.round(reading.levelDb)} dB · 底噪 ${reading.floorDb === null ? '—' : Math.round(reading.floorDb)} dB · 「${SENSITIVITY_LABELS[level]}」档门限 ${threshold === null ? '—' : Math.round(threshold)} dB`}
              </p>
              <p className="vr-settings-note vr-settings-ok">
                {ready ? adviceFor(reading.floorDb!, level) : '先别出声，等 3 秒…'}
              </p>
              {reading.last !== '' ? <p className="vr-settings-note">{reading.last}</p> : null}
            </>
          )
        : null}
      {error !== null ? <p className="vr-settings-note vr-settings-error">{error}</p> : null}
    </div>
  )
}
