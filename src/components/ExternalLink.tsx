import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react'
import { EXTERNAL_LINK_HINT, openExternalLink } from '../utils/openExternalLink'

interface Props extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'onClick'> {
  href: string
  children: ReactNode
  /** 是否在 title 中附带复用说明 */
  showHint?: boolean
}

/** 全站外链：点击走 openExternalLink，禁止无条件每次新开 */
export function ExternalLink({ href, children, showHint = true, className, title, ...rest }: Props) {
  const tip = showHint
    ? title
      ? `${title}（${EXTERNAL_LINK_HINT}）`
      : EXTERNAL_LINK_HINT
    : title
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    openExternalLink(href)
  }
  return (
    <a
      {...rest}
      href={href}
      className={className}
      title={tip}
      rel="noreferrer"
      onClick={onClick}
    >
      {children}
    </a>
  )
}
