"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { cn } from "@/lib/utils";

function Drawer(props: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerPortal(
  props: React.ComponentProps<typeof DrawerPrimitive.Portal>,
) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose(
  props: React.ComponentProps<typeof DrawerPrimitive.Close>,
) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[1px]",
        className,
      )}
      data-slot="drawer-overlay"
      {...props}
    />
  );
}

function DrawerContent({
  children,
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal>
      <DrawerPrimitive.Content
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex h-dvh w-[min(94vw,34rem)] flex-col border-l bg-background shadow-2xl outline-none",
          className,
        )}
        data-slot="drawer-content"
        {...props}
      >
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
}

function DrawerHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("grid gap-1.5 border-b px-5 py-5 sm:px-7", className)}
      data-slot="drawer-header"
      {...props}
    />
  );
}

function DrawerFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("mt-auto border-t px-5 py-4 sm:px-7", className)}
      data-slot="drawer-footer"
      {...props}
    />
  );
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      className={cn("text-xl font-semibold tracking-tight", className)}
      data-slot="drawer-title"
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      className={cn("text-sm leading-6 text-muted-foreground", className)}
      data-slot="drawer-description"
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
};
