<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#12162a">
    <?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<div class="ambient" aria-hidden="true"></div>

<nav class="nav" id="mainNav" role="navigation" aria-label="Main navigation">
  <div class="nav-inner">
    <a href="<?php echo esc_url(home_url('/')); ?>" class="nav-logo" aria-label="Vantly home">
      <div class="nav-logo-icon" aria-hidden="true">
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <polygon points="84,20 73,20 47,80 55,80" fill="#3a4070"/>
          <polygon points="18,20 29,20 55,80 47,80" fill="#e2924a"/>
          <circle cx="50" cy="40" r="7" fill="#f4c88b"/>
        </svg>
      </div>
      Vantly
    </a>

    <?php
    // The #features / #how-it-works / #modules / #pricing anchors only exist on the front
    // page — everywhere else these need the homepage URL prepended, or "Features" on the
    // About page just does nothing. vantly.js's smooth-scroll handler still works either way:
    // it only intercepts the click when the target id already exists on the current page.
    $anchor_base = is_front_page() ? '' : esc_url(home_url('/'));
    ?>
    <ul class="nav-links" role="list">
      <li><a href="<?php echo $anchor_base; ?>#features">Features</a></li>
      <li><a href="<?php echo $anchor_base; ?>#how-it-works">How it works</a></li>
      <li><a href="<?php echo $anchor_base; ?>#modules">Tools</a></li>
      <li><a href="<?php echo $anchor_base; ?>#pricing">Pricing</a></li>
    </ul>

    <div class="nav-right">
      <a href="https://vantly-xi.vercel.app" class="btn-ghost">Sign in</a>
      <a href="https://vantly-xi.vercel.app/signup" class="btn-primary">
        Get started
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
      </a>
      <button class="nav-toggle" aria-label="Toggle navigation" id="navToggle">
        <span></span><span></span><span></span>
      </button>
    </div>
  </div>
</nav>

<main>
