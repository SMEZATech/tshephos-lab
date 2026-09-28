<?php
function vantly_theme_setup() {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    register_nav_menus(array('primary' => 'Primary Menu'));
}
add_action('after_setup_theme', 'vantly_theme_setup');

// Add custom SVG upload support
function vantly_mime_types($mimes) {
    $mimes['svg'] = 'image/svg+xml';
    return $mimes;
}
add_filter('upload_mimes', 'vantly_mime_types');

// The theme's entire design system lives in style.css (one file, same one WordPress requires
// for the theme header comment) — enqueued properly instead of the raw <script src=cdn.tailwindcss.com>
// + ad-hoc inline <style> block the theme shipped with before. That combination was two
// different, uncached, unversioned ways of styling the same pages at once, which is the kind
// of thing that looks "unstable" from one edit to the next: a change to one never touched the
// other, so nothing added up consistently. filemtime() as the version string means a browser
// or CDN cache is invalidated automatically on every real edit — no manual cache-busting to
// remember, and no stale CSS surviving a deploy.
function vantly_enqueue_assets() {
    wp_enqueue_style(
        'vantly-fonts',
        'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,800;1,9..144,400&family=Public+Sans:wght@400;500;600;700;800&display=swap',
        array(),
        null
    );
    wp_enqueue_style(
        'vantly-style',
        get_stylesheet_uri(),
        array(),
        filemtime(get_stylesheet_directory() . '/style.css')
    );
    wp_enqueue_script(
        'vantly-main',
        get_stylesheet_directory_uri() . '/vantly.js',
        array(),
        filemtime(get_stylesheet_directory() . '/vantly.js'),
        true
    );
}
add_action('wp_enqueue_scripts', 'vantly_enqueue_assets');
