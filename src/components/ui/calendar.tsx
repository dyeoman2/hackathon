import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';
import { buttonVariants } from '~/components/ui/button';
import { cn } from '~/lib/utils';

export interface CalendarProps {
  selected?: Date;
  onSelect?: (date: Date | undefined) => void;
  month?: Date;
  onMonthChange?: (date: Date) => void;
  disabled?: boolean;
  className?: string;
  mode?: 'single' | 'range';
  initialFocus?: boolean;
  showOutsideDays?: boolean;
}

function Calendar({
  selected,
  onSelect,
  month: controlledMonth,
  onMonthChange,
  disabled = false,
  className,
  mode = 'single',
  showOutsideDays = true,
  initialFocus,
  ...props
}: CalendarProps) {
  const [internalMonth, setInternalMonth] = React.useState(
    controlledMonth || selected || new Date(),
  );
  const month = controlledMonth || internalMonth;

  const handleMonthChange = (newMonth: Date) => {
    if (!controlledMonth) {
      setInternalMonth(newMonth);
    }
    onMonthChange?.(newMonth);
  };

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const weekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const isDateDisabled = (date: Date) => {
    const today = startOfDay(new Date());
    const dateToCheck = startOfDay(date);
    return isBefore(dateToCheck, today);
  };

  const handleDateClick = (date: Date) => {
    if (disabled) return;
    if (!isSameMonth(date, month) && !showOutsideDays) return;
    if (isDateDisabled(date)) return;
    onSelect?.(date);
  };

  const goToPreviousMonth = () => {
    handleMonthChange(subMonths(month, 1));
  };

  const goToNextMonth = () => {
    handleMonthChange(addMonths(month, 1));
  };

  return (
    <div className={cn('p-3', className)} {...props}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={goToPreviousMonth}
            disabled={disabled}
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 disabled:opacity-30',
            )}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="text-sm font-medium">{format(month, 'MMMM yyyy')}</div>
          <button
            type="button"
            onClick={goToNextMonth}
            disabled={disabled}
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 disabled:opacity-30',
            )}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Days of week */}
        <div className="grid grid-cols-7 gap-0">
          {weekDays.map((day) => (
            <div
              key={day}
              className="text-muted-foreground flex h-9 w-9 items-center justify-center rounded-md font-normal text-[0.8rem]"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid w-full grid-cols-7 gap-0">
          {days.map((day, dayIdx) => {
            const isOutsideMonth = !isSameMonth(day, month);
            const isSelected = selected && isSameDay(day, selected);
            const isToday = isSameDay(day, new Date());
            const isPast = isDateDisabled(day);
            const isDateClickable =
              !disabled && !isPast && (isSameMonth(day, month) || showOutsideDays);

            return (
              <div
                key={day.toString()}
                className={cn(
                  'relative p-0 text-center text-sm focus-within:relative focus-within:z-20',
                  dayIdx === 0 && '[&:has([aria-selected])]:rounded-l-md',
                  dayIdx === 6 && '[&:has([aria-selected])]:rounded-r-md',
                )}
              >
                <button
                  type="button"
                  onClick={() => handleDateClick(day)}
                  disabled={disabled || isPast || (isOutsideMonth && !showOutsideDays)}
                  className={cn(
                    buttonVariants({ variant: 'ghost' }),
                    'h-9 w-9 p-0 font-normal',
                    isSelected &&
                      'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
                    !isSelected && isToday && 'bg-accent text-accent-foreground',
                    !isSelected &&
                      !isToday &&
                      isDateClickable &&
                      'hover:bg-accent hover:text-accent-foreground',
                    (isOutsideMonth || isPast) && 'text-muted-foreground opacity-50',
                    (disabled || isPast) && 'pointer-events-none cursor-not-allowed',
                  )}
                >
                  {format(day, 'd')}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
