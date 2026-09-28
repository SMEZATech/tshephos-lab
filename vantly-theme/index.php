<?php get_header(); ?>

<header class="page-header">
    <span class="hero-eyebrow" style="display:inline-flex;"><span class="dot" aria-hidden="true"></span> Knowledge Hub</span>
    <h1>Vantly Insights</h1>
    <p class="page-sub">Strategies, guides, and deep-dives for growing brands scaling their content with AI.</p>
</header>

<?php
$insights = new WP_Query(array('post_type' => 'post', 'post_status' => 'publish', 'posts_per_page' => -1));
?>

<section class="insights-section">
<?php if ($insights->have_posts()) : $insights->the_post(); ?>

    <a href="<?php the_permalink(); ?>" class="insights-featured">
        <div class="thumb" style="<?php echo has_post_thumbnail() ? 'background-image:url(' . esc_url(get_the_post_thumbnail_url(null, 'full')) . ');' : ''; ?>"></div>
        <div class="body">
            <span class="eyebrow-pill">Featured</span>
            <h2><?php the_title(); ?></h2>
            <p><?php echo esc_html(wp_trim_words(get_the_excerpt(), 28)); ?></p>
            <span class="date"><?php echo esc_html(get_the_date()); ?></span>
        </div>
    </a>

    <?php if ($insights->post_count > 1) : ?>
    <div class="insights-grid">
        <?php while ($insights->have_posts()) : $insights->the_post(); ?>
        <a href="<?php the_permalink(); ?>" class="insight-card">
            <div class="thumb" style="<?php echo has_post_thumbnail() ? 'background-image:url(' . esc_url(get_the_post_thumbnail_url(null, 'medium_large')) . ');' : ''; ?>"></div>
            <div class="body">
                <h3><?php the_title(); ?></h3>
                <span class="date"><?php echo esc_html(get_the_date()); ?></span>
            </div>
        </a>
        <?php endwhile; ?>
    </div>
    <?php endif; ?>

<?php else : ?>
    <p class="insights-empty">Nothing published yet — check back soon.</p>
<?php endif; wp_reset_postdata(); ?>
</section>

<?php get_footer(); ?>
