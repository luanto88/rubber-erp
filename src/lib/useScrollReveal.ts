"use client"
import { useEffect, useRef, useCallback } from "react"

/**
 * Scroll-reveal hook: applies 'revealed' class when elements enter viewport.
 * Usage:
 *   const revealRef = useScrollReveal()
 *   <div ref={revealRef} className="scroll-reveal">...</div>
 */
export function useScrollReveal(options?: { threshold?: number; rootMargin?: string }) {
  const observerRef = useRef<IntersectionObserver | null>(null)
  const elementsRef = useRef<Set<Element>>(new Set())

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("revealed")
            observerRef.current?.unobserve(entry.target)
          }
        })
      },
      {
        threshold: options?.threshold ?? 0.1,
        rootMargin: options?.rootMargin ?? "0px 0px -40px 0px",
      }
    )

    // Observe any elements already registered
    elementsRef.current.forEach((el) => {
      observerRef.current?.observe(el)
    })

    return () => {
      observerRef.current?.disconnect()
    }
  }, [options?.threshold, options?.rootMargin])

  const ref = useCallback((node: HTMLElement | null) => {
    if (node) {
      elementsRef.current.add(node)
      observerRef.current?.observe(node)
    }
  }, [])

  return ref
}
