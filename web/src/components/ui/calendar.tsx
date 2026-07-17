import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "@daypicker/react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      data-slot="calendar"
      showOutsideDays={showOutsideDays}
      className={cn("p-0", className)}
      classNames={{
        months: "relative flex flex-col gap-4",
        month: "space-y-4",
        month_caption: "flex items-center justify-center pt-1",
        caption_label: "text-sm font-medium",
        nav: "absolute inset-x-0 top-1 flex items-center justify-between px-1",
        button_previous: cn(buttonVariants({ variant: "outline", size: "icon" }), "size-7 bg-transparent p-0 opacity-70 hover:opacity-100"),
        button_next: cn(buttonVariants({ variant: "outline", size: "icon" }), "size-7 bg-transparent p-0 opacity-70 hover:opacity-100"),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday: "w-9 rounded-md text-[0.8rem] font-normal text-muted-foreground",
        week: "mt-2 flex w-full",
        day: "relative size-9 p-0 text-center text-sm focus-within:relative focus-within:z-20",
        day_button: cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-9 p-0 font-normal aria-selected:opacity-100"),
        selected: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button:hover]:bg-primary [&>button:hover]:text-primary-foreground",
        today: "[&>button]:bg-accent [&>button]:text-accent-foreground",
        outside: "text-muted-foreground opacity-45",
        disabled: "text-muted-foreground opacity-45",
        range_middle: "[&>button]:bg-accent [&>button]:text-accent-foreground",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => orientation === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />,
      }}
      {...props}
    />
  );
}

export { Calendar };
