import { format } from 'date-fns';
import { CalendarIcon, ChevronDown, ChevronUp } from 'lucide-react';
import * as React from 'react';
import { Button } from '~/components/ui/button';
import { Calendar } from '~/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover';
import { cn } from '~/lib/utils';

interface DateTimePickerProps {
  date?: Date;
  onDateChange?: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  required?: boolean;
  preserveTime?: boolean;
}

function TimePicker({ date, onTimeChange }: { date: Date; onTimeChange: (date: Date) => void }) {
  const [hours, setHours] = React.useState(date.getHours());
  const [minutes, setMinutes] = React.useState(date.getMinutes());
  const [isAM, setIsAM] = React.useState(date.getHours() < 12);

  // Track the last date we sent to parent to avoid reset loops
  const lastSentDateRef = React.useRef<Date | null>(null);

  React.useEffect(() => {
    // Only update state if this is a different date than what we last sent
    const dateTime = date.getTime();
    const lastSentTime = lastSentDateRef.current?.getTime();

    if (lastSentTime !== dateTime) {
      const newHours = date.getHours();
      const newMinutes = date.getMinutes();
      const newIsAM = newHours < 12;
      setHours(newHours);
      setMinutes(newMinutes);
      setIsAM(newIsAM);
      // Don't update lastSentDateRef here - only update it when we send a date
    }
  }, [date]);

  const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  const displayMinute = minutes.toString().padStart(2, '0');

  const updateTime = React.useCallback(
    (newHours: number, newMinutes: number) => {
      // Create new date from the current date prop and update time
      const newDate = new Date(date);
      newDate.setHours(newHours, newMinutes, 0, 0);
      lastSentDateRef.current = newDate;
      onTimeChange(newDate);
    },
    [date, onTimeChange],
  );

  const adjustHour = React.useCallback(
    (delta: number) => {
      const currentDisplayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
      let newDisplayHour = currentDisplayHour + delta;
      if (newDisplayHour < 1) newDisplayHour = 12;
      if (newDisplayHour > 12) newDisplayHour = 1;

      // Convert display hour (1-12) to 24-hour format
      let adjustedHour: number;
      if (isAM) {
        adjustedHour = newDisplayHour === 12 ? 0 : newDisplayHour;
      } else {
        adjustedHour = newDisplayHour === 12 ? 12 : newDisplayHour + 12;
      }

      setHours(adjustedHour);
      updateTime(adjustedHour, minutes);
    },
    [hours, isAM, minutes, updateTime],
  );

  const adjustMinute = React.useCallback(
    (delta: number) => {
      let newMinute = minutes + delta;
      if (newMinute < 0) newMinute = 59;
      if (newMinute > 59) newMinute = 0;

      setMinutes(newMinute);
      updateTime(hours, newMinute);
    },
    [minutes, hours, updateTime],
  );

  const handleAMPMToggle = React.useCallback(() => {
    const newIsAM = !isAM;
    setIsAM(newIsAM);
    let adjustedHour = hours;
    if (newIsAM && hours >= 12) {
      adjustedHour = hours - 12;
      if (adjustedHour === 0) adjustedHour = 12;
    } else if (!newIsAM && hours < 12) {
      adjustedHour = hours === 12 ? 12 : hours + 12;
    }
    setHours(adjustedHour);
    updateTime(adjustedHour, minutes);
  }, [isAM, hours, minutes, updateTime]);

  return (
    <div className="border-t border-border p-4">
      <div className="flex items-center justify-center gap-3">
        <div className="flex flex-col items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-7 w-14 rounded-md"
            onClick={(e) => {
              e.stopPropagation();
              adjustHour(1);
            }}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <div className="flex h-10 w-14 items-center justify-center rounded-md border border-input bg-background text-sm font-medium shadow-xs">
            {displayHour.toString().padStart(2, '0')}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-7 w-14 rounded-md"
            onClick={(e) => {
              e.stopPropagation();
              adjustHour(-1);
            }}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>

        <span className="text-lg font-semibold text-foreground">:</span>

        <div className="flex flex-col items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-7 w-14 rounded-md"
            onClick={(e) => {
              e.stopPropagation();
              adjustMinute(1);
            }}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <div className="flex h-10 w-14 items-center justify-center rounded-md border border-input bg-background text-sm font-medium shadow-xs">
            {displayMinute}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-7 w-14 rounded-md"
            onClick={(e) => {
              e.stopPropagation();
              adjustMinute(-1);
            }}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>

        <div className="ml-2 flex flex-col gap-1">
          <Button
            type="button"
            variant={isAM ? 'default' : 'outline'}
            size="sm"
            className="h-8 w-14 text-xs font-medium"
            onClick={(e) => {
              e.stopPropagation();
              handleAMPMToggle();
            }}
          >
            AM
          </Button>
          <Button
            type="button"
            variant={!isAM ? 'default' : 'outline'}
            size="sm"
            className="h-8 w-14 text-xs font-medium"
            onClick={(e) => {
              e.stopPropagation();
              handleAMPMToggle();
            }}
          >
            PM
          </Button>
        </div>
      </div>
    </div>
  );
}

function normalizeDate(d: Date | undefined, preserveTime = false): Date | undefined {
  if (!d) return undefined;
  const normalized = new Date(d);
  if (!preserveTime) {
    // Set to 11:59 PM as default time
    normalized.setHours(23, 59, 0, 0);
  }
  return normalized;
}

export function DateTimePicker({
  date,
  onDateChange,
  placeholder = 'Pick a date and time',
  disabled = false,
  className,
  preserveTime = false,
}: DateTimePickerProps) {
  // Track the last date prop we received to detect external changes
  const lastDatePropRef = React.useRef<Date | undefined>(date);
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(
    date ? normalizeDate(date, preserveTime) : undefined,
  );

  React.useEffect(() => {
    // Only update if the date part (not time) actually changed from outside
    const lastDateStr = lastDatePropRef.current?.toDateString();
    const currentDateStr = date?.toDateString();

    if (lastDateStr !== currentDateStr) {
      lastDatePropRef.current = date;

      if (date) {
        // Date part changed, normalize to 11:59 PM unless preserveTime is true
        // (time-only changes from TimePicker won't trigger this)
        setSelectedDate(normalizeDate(date, preserveTime));
      } else {
        setSelectedDate(undefined);
      }
    } else if (date && lastDatePropRef.current) {
      // Same date, but prop reference might have changed - update ref but don't reset state
      lastDatePropRef.current = date;
    }
  }, [date, preserveTime]);

  const handleDateSelect = (newDate: Date | undefined) => {
    if (newDate) {
      const updatedDate = new Date(newDate);
      if (selectedDate) {
        // Preserve the time from the previously selected date
        updatedDate.setHours(selectedDate.getHours());
        updatedDate.setMinutes(selectedDate.getMinutes());
        updatedDate.setSeconds(selectedDate.getSeconds());
      } else {
        // Default to 11:59 PM if no time was previously selected
        updatedDate.setHours(23, 59, 0, 0);
      }
      setSelectedDate(updatedDate);
      onDateChange?.(updatedDate);
    } else {
      setSelectedDate(undefined);
      onDateChange?.(undefined);
    }
  };

  const handleTimeChange = (newDate: Date) => {
    setSelectedDate(newDate);
    onDateChange?.(newDate);
  };

  const displayValue = selectedDate ? format(selectedDate, "PPP 'at' p") : placeholder;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'w-full justify-start text-left font-normal',
            !selectedDate && 'text-muted-foreground',
            className,
          )}
          disabled={disabled}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {displayValue}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={selectedDate} onSelect={handleDateSelect} initialFocus />
        {selectedDate && <TimePicker date={selectedDate} onTimeChange={handleTimeChange} />}
      </PopoverContent>
    </Popover>
  );
}
