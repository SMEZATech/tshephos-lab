<?php get_header(); ?>

<header class="page-header" style="padding-top: 130px; padding-bottom: 40px; max-width: 900px; margin: 0 auto; text-align: center;">
    <nav class="breadcrumbs" style="font-size: 13.5px; font-weight: 500; color: var(--faint); margin-bottom: 28px; display: flex; align-items: center; justify-content: center; gap: 10px;">
        <a href="<?php echo esc_url(home_url('/')); ?>" style="color: var(--dim); text-decoration: none; transition: color 0.2s;">Home</a>
        <span style="opacity: 0.5;">/</span>
        <span style="color: var(--accent);">Insights</span>
    </nav>

    <span class="eyebrow" style="display:inline-flex; align-items:center; gap:8px; font-size: 11px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; color: var(--dim);"><span style="display:block;width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px var(--accent);" aria-hidden="true"></span> Knowledge Hub</span>
    <h1 style="margin-top: 16px; font-size: clamp(36px, 5vw, 56px); margin-bottom: 18px;">Vantly Insights</h1>
    <p class="page-sub" style="font-size: 18px; color: var(--dim); max-width: 600px; margin: 0 auto;">Strategies, guides, and deep-dives for growing brands scaling their content with AI.</p>
</header>

<?php
$insights = new WP_Query(array('post_type' => 'post', 'post_status' => 'publish', 'posts_per_page' => -1));
?>

<section class="insights-section" style="max-width: 1160px; margin: 0 auto; padding: 24px 24px 120px;">
<?php if ($insights->have_posts()) : $insights->the_post(); 
      $categories = get_the_category();
      $cat_name = !empty($categories) ? esc_html($categories[0]->name) : 'Featured';
?>

    <a href="<?php the_permalink(); ?>" class="insights-featured" style="display:flex; flex-wrap:wrap; border-radius:24px; overflow:hidden; border:1px solid var(--border); background:var(--surface); margin-bottom:64px; text-decoration:none; box-shadow: 0 10px 40px -10px rgba(0,0,0,0.3); transition: transform 0.25s, border-color 0.25s;">
        <div class="thumb" style="flex: 1 1 450px; min-height: 320px; background: var(--surface2); background-image:url('<?php echo esc_url(get_the_post_thumbnail_url(null, 'full')); ?>'); background-size: cover; background-position: center; border-right: 1px solid var(--border);"></div>
        <div class="body" style="flex: 1 1 400px; padding: 56px 48px; display: flex; flex-direction: column; justify-content: center;">
            <span style="font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); background: rgba(226,146,74,.1); border: 1px solid rgba(226,146,74,.25); border-radius: 100px; padding: 6px 14px; align-self: flex-start; margin-bottom: 20px;"><?php echo $cat_name; ?></span>
            <h2 style="font-family: var(--fd); font-weight: 800; font-size: clamp(28px, 4vw, 36px); color: var(--text); margin-bottom: 16px; line-height: 1.15; letter-spacing: -0.02em;"><?php the_title(); ?></h2>
            <p style="color: var(--dim); font-size: 16px; line-height: 1.6; margin-bottom: 32px;"><?php echo esc_html(wp_trim_words(get_the_excerpt(), 25)); ?></p>
            <div style="display: flex; align-items: center; gap: 12px; margin-top: auto;">
                <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--surface2); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-family: var(--fd); font-weight: bold; color: var(--accent); font-size: 14px;">V</div>
                <div style="display: flex; flex-direction: column;">
                    <span style="font-size: 13.5px; font-weight: 600; color: var(--text);">Vantly Editorial Team</span>
                    <span style="font-size: 12px; color: var(--faint);"><?php echo esc_html(get_the_date()); ?> &middot; <?php echo ceil(str_word_count(strip_tags(get_the_content())) / 250); ?> min read</span>
                </div>
            </div>
        </div>
    </a>

    <?php if ($insights->post_count > 1) : ?>
    <div class="insights-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 32px;">
        <?php while ($insights->have_posts()) : $insights->the_post(); 
              $categories = get_the_category();
              $cat_name = !empty($categories) ? esc_html($categories[0]->name) : 'Article';
        ?>
        <a href="<?php the_permalink(); ?>" class="insight-card" style="text-decoration:none; display:flex; flex-direction:column; border-radius:20px; background:var(--surface); border:1px solid var(--border); overflow:hidden; box-shadow: 0 4px 20px -5px rgba(0,0,0,0.2); transition: transform 0.25s, border-color 0.25s;">
            <div class="thumb" style="height: 220px; background: var(--surface2); background-image:url('<?php echo esc_url(get_the_post_thumbnail_url(null, 'medium_large')); ?>'); background-size: cover; background-position: center; border-bottom: 1px solid var(--border);"></div>
            <div class="body" style="padding: 32px; display: flex; flex-direction: column; flex: 1;">
                <span style="font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); margin-bottom: 12px; display: block;"><?php echo $cat_name; ?></span>
                <h3 style="font-family: var(--fd); font-weight: 700; font-size: 22px; color: var(--text); line-height: 1.3; margin-bottom: 20px; letter-spacing: -0.01em;"><?php the_title(); ?></h3>
                
                <div style="display: flex; align-items: center; justify-content: space-between; margin-top: auto; padding-top: 20px; border-top: 1px solid var(--border);">
                    <span style="font-size: 12.5px; color: var(--faint); font-weight: 500;"><?php echo esc_html(get_the_date()); ?></span>
                    <span style="font-size: 12.5px; color: var(--faint); font-weight: 500;"><?php echo ceil(str_word_count(strip_tags(get_the_content())) / 250); ?> min read</span>
                </div>
            </div>
        </a>
        <?php endwhile; ?>
    </div>
    <?php endif; ?>

<?php else : ?>
    <div style="text-align: center; padding: 80px 24px; border: 1px solid var(--border); border-radius: 20px; background: var(--surface);">
        <p style="color: var(--dim); font-size: 16px;">Nothing published yet ?" check back soon.</p>
    </div>
<?php endif; wp_reset_postdata(); ?>
</section>

<?php get_footer(); ?>