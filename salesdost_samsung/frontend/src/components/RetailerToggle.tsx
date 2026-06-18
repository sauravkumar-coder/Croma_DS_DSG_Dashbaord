import { useRetailerContext } from '@/contexts/RetailerContext'
import { RETAILER_IDS, getRetailerConfig } from '@/retailers/retailerFactory'
import { cn } from '@/lib/utils'

export function RetailerToggle() {
  const { retailer, setRetailer } = useRetailerContext()
  return (
    <div className="flex items-center bg-gray-100 rounded-full p-0.5 gap-0.5">
      {RETAILER_IDS.map(id => {
        const cfg = getRetailerConfig(id)
        const active = retailer === id
        return (
          <button
            key={id}
            onClick={() => setRetailer(id)}
            className={cn(
              'relative h-7 px-4 rounded-full text-xs font-semibold transition-all duration-200',
              active ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700',
            )}
            style={active
              ? { background: `linear-gradient(to right, ${cfg.brandFrom}, ${cfg.brandTo})` }
              : {}}
          >
            {cfg.label}
          </button>
        )
      })}
    </div>
  )
}
