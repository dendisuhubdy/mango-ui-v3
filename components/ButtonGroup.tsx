// import { useViewport } from '../hooks/useViewport'
// import { breakpoints } from './TradePageGrid'
import { FunctionComponent } from 'react'

interface ButtonGroupProps {
  activeValue: string
  onChange: (x) => void
  unit?: string
  values: Array<string>
}

const ButtonGroup: FunctionComponent<ButtonGroupProps> = ({
  activeValue,
  unit,
  values,
  onChange,
}) => {
  // const { width } = useViewport()
  // const isMobile = width ? width < breakpoints.sm : false
  return (
    <div className="bg-th-bkg-3 rounded-md">
      <div className="flex relative">
        {activeValue ? (
          <div
            className={`absolute bg-th-bkg-4 default-transition h-full left-0 top-0 rounded-md transform`}
            style={{
              transform: `translateX(${
                values.findIndex((v) => v === activeValue) * 100
              }%)`,
              width: `${100 / values.length}%`,
            }}
          />
        ) : null}
        {values.map((v, i) => (
          <button
            className={`cursor-pointer default-transition font-normal px-2 py-1.5 relative rounded-md text-center text-xs w-1/2
              ${
                v === activeValue
                  ? `text-th-primary`
                  : `text-th-fgd-1 opacity-50 hover:opacity-100`
              }
            `}
            key={`${v}${i}`}
            onClick={() => onChange(v)}
            style={{
              width: `${100 / values.length}%`,
            }}
          >
            {v}
            {unit}
          </button>
        ))}
      </div>
    </div>
  )
}

export default ButtonGroup