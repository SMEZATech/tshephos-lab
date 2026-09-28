<?php get_header(); ?>
<?php while (have_posts()) : the_post(); ?>
    <header class="page-header">
        <h1><?php the_title(); ?></h1>
    </header>
    <article id="post-<?php the_ID(); ?>" <?php post_class('page-content'); ?>>
        <?php the_content(); ?>
    </article>
<?php endwhile; ?>
<?php get_footer(); ?>
