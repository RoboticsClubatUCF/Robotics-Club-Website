<?php
  
  class Header { 
    private $current;
    private $previous;
    private $next;

    public function __construct($pageCreator, $pageCreationDate, $currentWebmaster, $updateDate, $title, $pageDescription) {
      $this-pageCreator = $pageCreator;
      $this->pageCreationDate = $pageCreationDate;
      $this->title = $title;
      $this->currentWebmaster = $currentWebmaster;
      $this->updateDate -> $updateDate;
      $this->pageDescription->$pageDescription;
      $this->keywords = $keywords
      $this->$
      $this->
    }
    
    public function generateComment() {
      
    }
    
    public function generateCSS() {
    
    }
    
    public function generateCommon() {
      echo "<html lang=\"en\">\n\t
              <head>\n\t\t
                <!-- bare minimum -->
                <meta charset=\"UTF-8\">\n\t\t
                <meta name=\"viewport\" content=\"width=device-width, initial-scale=1, shrink-to-fit=no\">\n\t\t\n\n
              
                <!-- icons -->\t\t
                <link rel=\"icon\" href=\"/assets/imgs/favicon.ico\" />
                <link rel=\"roboskull icon\" href=\"/assets/imgs/favicon.ico\" />
                <link rel=\"mask-icon\" href=\"/assets/imgs/favicon.ico\" color=\"white\" />
                <link rel=apple-touch-icon sizes="114Ã—4" href="/assets/imgs/favicon.ico" />
                <link rel=apple-touch-icon sizes="72x72" href="/assets/imgs/favicon.ico"/>
                <link rel=apple-touch-icon href="/assets/imgs/favicon.ico" />
              
                <!-- verification of ownership for google search -->
                <meta name="google-site-verification" content="NDgsiRwy1o33-MY4WCiz7Fi69rFDe5iEHkB2cfptC8I" />
              
                <!-- Global site tag (gtag.js) - Google Analytics -->
                <script async src="https://www.googletagmanager.com/gtag/js?id=UA-18245445-1"></script>
                <script>
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  gtag('js', new Date());
              
                  gtag('config', 'UA-18245445-1');
                </script>
              
                <!-- geotags -->
                <meta name="ICBM" content="28.585626, -81.199236">
                <meta name="geo.position" content="28.585626;-81.199236">
                <meta name="geo.region" content="US-FL">
                <meta name="geo.placename" content="Orlando">
    }
    
    public function generateSchema() {
    
    }
    
    public function generateCSS() {
    
    }
}

<!DOCTYPE html>
<!--  Website created by Alexandra French
      For the Robotics Club of Central Florida
      Contact club: ucfroboticsclubnews@gmail.com
                    robotics@ucf.edu

      Page created by: <?php echo $pageCreator; ?>
      Page created on: <?php echo $pageCreationDate; ?>
      Page last updated on: <?php echo $updateDate; ?>
      Page last updated by: <?php echo $currentWebmaster; ?>
-->



  <!-- Website Info -->
  <title><?php echo $title; ?></title>
  <meta name="author" content="<?php echo $pageCreator; ?>">
  <meta name="description" content="<?php echo $pageDescription; ?>">
  <meta name="keywords" content="<?php echo $pageDescription; ?>">
  <link rel="canonical" href="<?php echo $url; ?>" />

  <!-- facebook open graphs -->
  <meta property="og:url"                content="<?php echo $url; ?>" />
  <meta property="og:type"               content="website" />
  <meta property="og:title"              content="<?php echo $title; ?>" />
  <meta property="og:description"        content="<?php echo $pageDescription; ?>" />
  <meta property="og:image"              content="<?php echo $markupImage?:"https://robotics.ucf.edu/assets/imgs/header/roboskull-black.png"; ?>" />

  <!-- twitter card -->
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:site" content="@RoboticsClubCFl" />
  <meta name="twitter:title" content="<?php echo $title; ?>" />
  <meta name="twitter:description" content="<?php echo $pageDescription; ?>" />
  <meta name="twitter:image" content="<?php echo $markupImage?:"https://robotics.ucf.edu/assets/imgs/header/roboskull-black.png"; ?>" />

  <!-- schema markup  -->
  <script type="application/ld+json">
  {
    "@context" : "https://schema.org",
    "@type" : "WebSite",
    "author" : "Robotics Club of Central Florida",
    "image" : "<?php echo $markupImage?:"https://robotics.ucf.edu/assets/imgs/header/roboskull-black.png"; ?>",
    "description" : "<?php echo $description; ?>",
    "name" : "<?php echo $title; ?>",
    "url" : "<?php echo $url; ?>",
    "sameAs" : [
      "https://facebook.com/RoboticsClub",
      "https://instagram.com/RoboticsClubCFl",
      "https://twitter.com/RoboticsClubCFl",
      "https://www.youtube.com/channel/UCZEPdNUFzkciC7MIiI-yPKg",
      "https://linkedin.com/company/robotics-club-at-ucf"
    ]
  }
  </script>

  <!-- Bootstrap css -->
  <link href="/assets/rsrc/bootstrap/css/bootstrap.min.css" rel="stylesheet">

  <!-- Global css styles -->
  <link href="/assets/css/global-styles.css" rel="stylesheet">

  <?php if (function_exists('customCssStyles')){
    customCssStyles();
  }?>
</head>

<body>
