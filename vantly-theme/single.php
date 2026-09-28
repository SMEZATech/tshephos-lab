<?php get_header(); ?>
<?php while (have_posts()) : the_post(); ?>
    <header class="page-header" style="padding-bottom:0;">
        <h1><?php the_title(); ?></h1>
        <p class="page-sub"><?php echo esc_html(get_the_date()); ?> &middot; By Vantly Editorial</p>
    </header>

    <?php if (has_post_thumbnail()) : ?>
        <div style="max-width:900px;margin:40px auto 0;padding:0 24px;">
            <div style="width:100%;height:420px;overflow:hidden;border-radius:18px;">
                <?php the_post_thumbnail('full', ['style' => 'width:100%;height:100%;object-fit:cover;display:block;']); ?>
            </div>
        </div>
    <?php endif; ?>

    <article id="post-<?php the_ID(); ?>" <?php post_class('page-content'); ?>>
        <?php the_content(); ?>
    </article>
<?php endwhile; ?>
<?php get_footer(); ?>
