<?php
  // This class generates the header comment, common header elements, schema for SEO, and end of header
  // Created by Alexandra French on 11/11/2020
  // Last updated on 11/12/2020
  
  class Header { 
    private $pageCreator;
    private $pageCreationDate;
    private $currentWebmaster;
    private $updateDate;

    // take in the basic page info for the header
    public function __construct($pageCreator, $pageCreationDate, $currentWebmaster, $updateDate) {
      $this->pageCreator = $pageCreator;
      $this->pageCreationDate = $pageCreationDate;
      $this->currentWebmaster = $currentWebmaster;
      $this->updateDate = $updateDate;
    }

    // generate comment with page info
    public function generateComment() {
      echo "<!DOCTYPE html>\n";
      echo "<!--  Website created by Alexandra French\n";
      echo "      For the Robotics Club of Central Florida\n";
      echo "      Contact club: ucfroboticsclubnews@gmail.com\n";
      echo "                    robotics@ucf.edu\n";
      echo "      Page created by: " . $this->pageCreator . "\n";
      echo "      Page created on: " . $this->pageCreationDate . "\n";
      echo "      Page last updated on: " .  $this->updateDate . "\n";
      echo "      Page last updated by: " . $this->currentWebmaster . "\n";
      echo "-->\n\n";
    }
    
    // generates all the common needed things per page like icons. All attributes are required.
    public function generateCommon($title, $pageDescription, $keywords, $url) {
      echo "<html lang=\"en\">\n<head>\n
  <!-- bare minimum -->
  <meta charset=\"UTF-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1, shrink-to-fit=no\">
  
  <!-- icons -->\n
  <link rel=\"icon\" href=\"/assets/imgs/favicon.ico\" />
  <link rel=\"roboskull icon\" href=\"/assets/imgs/favicon.ico\" />
  <link rel=\"mask-icon\" href=\"/assets/imgs/favicon.ico\" color=\"white\" />
  <link rel=apple-touch-icon sizes=\"114x114\" href=\"/assets/imgs/favicon.ico\" />
  <link rel=apple-touch-icon sizes=\"72x72\" href=\"/assets/imgs/favicon.ico\" />
  <link rel=apple-touch-icon href=\"/assets/imgs/favicon.ico\" />
  
  <!-- verification of ownership for google search -->
  <meta name=\"google-site-verification\" content=\"NDgsiRwy1o33-MY4WCiz7Fi69rFDe5iEHkB2cfptC8I\" />
  
  <!-- Global site tag (gtag.js) - Google Analytics -->
  <script async src=\"https://www.googletagmanager.com/gtag/js?id=UA-18245445-1\"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
  
    gtag('config', 'UA-18245445-1');
  </script>
  
  <!-- geotags -->
  <meta name=\"ICBM\" content=\"28.585626, -81.199236\">
  <meta name=\"geo.position\" content=\"28.585626;-81.199236\">
  <meta name=\"geo.region\" content=\"US-FL\">
  <meta name=\"geo.placename\" content=\"Orlando\">
  
  <!-- Website Info -->";
      echo "\n  <title>" . $title . "</title>";
      echo "\n  <meta name=\"author\" content=\"" . $this->pageCreator . "\">";
      echo "\n  <meta name=\"description\" content=\"" . $pageDescription . "\">";
      echo "\n  <meta name=\"keywords\" content=\"" . $keywords . "\">";
      echo "\n  <link rel=\"canonical\" href=\"" . $url . "\" />";
                
    }
    
    // takes in an optional array of styles and outputs all the css for the page
    public function generateCSS($customCss) {
      echo "\n\n  <!-- CSS -->";
      echo "\n  <!-- Bootstrap -->";
      echo "\n  <link href=\"/assets/rsrc/bootstrap/css/bootstrap.min.css\" rel=\"stylesheet\">";
      echo "\n\n  <!-- custom js styles -->";
      echo"\n  <link href=\"/assets/css/global-styles.css\" rel=\"stylesheet\">";
  
      if (!empty($customCss)) {
        $this->customCssStyles($customCss);
      }
    }
    
    // takes an array of styles and generates them as js scripts
    private function customCssStyles($customCss) {
      echo "\n\n  <!-- Additional CSS styles -->";
      foreach ($customCss as $currentCss) {
        echo "\n  <link href=\"" . $currentCss . "\" rel=\"stylesheet\">";
      }
    }
    
    public function endHeader() {
      echo "\n\n</head>";
    }
    
    // generates a website schema, markupImage is optional    
    // used for most pages
    public function genWebsiteSEO($url, $title, $pageDescription, $markupImage) {
      $this->genOpenGraph($url, $title, $pageDescription, $markupImage);
      $this->genTwitterCard($url, $title, $pageDescription, $markupImage);
      
      echo "\n\n  <!-- schema markup  -->
  <script type=\"application/ld+json\">
  {
    \"@context\" : \"https://schema.org\",
    \"@type\" : \"WebSite\",
    \"author\" : \"Robotics Club of Central Florida\",\n";
      echo "    \"image\" : \"";
      if (isset($markupImage)) {
        echo $markupImage;
      } else {
        echo "https://robotics.ucf.edu/assets/imgs/header/roboskull-black.png";
      }
      echo "\",\n";
      echo "\"description\" : \"" . $pageDescription . "\",\n";
      echo "\"name\" : \"" . $title . "\",\n";
      echo "\"url\" : \"" . $url . "\",\n";
      echo "\"sameAs\" : [
      \"https://facebook.com/RoboticsClub\",
      \"https://instagram.com/RoboticsClubCFl\",
      \"https://twitter.com/RoboticsClubCFl\",
      \"https://www.youtube.com/channel/UCZEPdNUFzkciC7MIiI-yPKg\",
      \"https://linkedin.com/company/robotics-club-at-ucf\"
    ]
  }
  </script>";
    }
    
    
    // generates a project schema, markupImage is optional    
    // used for most pages
    public function genProjectSEO($url, $title, $pageDescription, $foundingDate, $markupImage) {
      $this->genOpenGraph($url, $title, $pageDescription, $markupImage);
      $this->genTwitterCard($url, $title, $pageDescription, $markupImage);
      
      echo "\n\n  <!-- schema markup  -->
  <script type=\"application/ld+json\">
  {
    \"@context\" : \"https://schema.org\",
    \"@type\" : \"Project\",";
      echo "    \"image\" : \"";
      if (isset($markupImage)) {
        echo $markupImage;
      } else {
        echo "https://robotics.ucf.edu/assets/imgs/header/roboskull-black.png";
      }
      echo "\",\n";
      echo "\"description\" : \"" . $pageDescription . "\",\n";
      echo "\"name\" : \"" . $title . "\",\n";
      echo "\"url\" : \"" . $url . "\",\n";
      echo "\"foundingDate\":\"" . $foundingDate . "\",";
      echo "\"sameAs\" : [
      \"https://facebook.com/RoboticsClub\",
      \"https://instagram.com/RoboticsClubCFl\",
      \"https://twitter.com/RoboticsClubCFl\",
      \"https://www.youtube.com/channel/UCZEPdNUFzkciC7MIiI-yPKg\",
      \"https://linkedin.com/company/robotics-club-at-ucf\"
    ]
  }
  </script>";
    }

    
    // generates an organization schema, markupImage is optional
    // mainly used for the title page
    public function genOrgSEO($url, $title, $pageDescription, $phone, $email, $markupImage) {
      $this->genOpenGraph($url, $title, $pageDescription, $markupImage);
      $this->genTwitterCard($url, $title, $pageDescription, $markupImage);
      
      echo "\n\n  <!-- schema markup  -->
  <script type=\"application/ld+json\">
  {
    \"@context\" : \"https://schema.org\",
    \"@type\" : \"Organization\",
    \"image\" : \"";
      if (isset($markupImage)) {
        echo $markupImage;
      } else {
          echo "https://robotics.ucf.edu/assets/imgs/header/roboskull-black.png";
      }
      echo"\",\n    \"name\" : \"Robotics Club of Central Florida\",";
      echo "\n    \"telephone\" : \"" . $phone . "\",";
      echo "\n    \"email\" : \"" . $email . "\",";
      echo "\n    \"address\" : {
      \"@type\" : \"PostalAddress\",
      \"streetAddress\" : \"Partnership II Rm 108, 3100 Technology Pkwy\",
      \"addressLocality\" : \"Orlando\",
      \"addressRegion\" : \"Florida\",
      \"addressCountry\" : \"USA\",
      \"postalCode\" : \"32826\"
    },";
      echo "    \"url\" : \"" . $url . "\",";
      echo "    \"sameAs\" : [
      \"https://facebook.com/RoboticsClub\",
      \"https://instagram.com/RoboticsClubCFl\",
      \"https://twitter.com/RoboticsClubCFl\",
      \"https://www.youtube.com/channel/UCZEPdNUFzkciC7MIiI-yPKg\",
      \"https://linkedin.com/company/robotics-club-at-ucf\"
    ]
  }
  </script>";
    }
    
    // generates a facebook open graph using a url, title, page description, and image
    private function genOpenGraph($url, $title, $pageDescription, $markupImage) {
      echo "\n\n  <!-- facebook open graphs -->";
      echo "\n  <meta property=\"og:url\"                content=\"" . $url . "\" />";
      echo "\n  <meta property=\"og:type\"               content=\"website\" />";
      echo "\n  <meta property=\"og:title\"              content=\"" . $title . "\" />";
      echo "\n  <meta property=\"og:description\"        content=\"" . $pageDescription . "\" />";
      echo "\n  <meta property=\"og:image\"              content=\"";
      if (isset($markupImage)) {
        echo $markupImage;
      } else {
        echo "https://robotics.ucf.edu/assets/imgs/header/roboskull-black.png";
      }
      echo "\" />\n";
    }
    
    // generates a twitter card using a url, title, page description, and image
    private function genTwitterCard($url, $title, $pageDescription, $markupImage) {
      echo "\n\n  <!-- twitter card -->";
      echo "\n  <meta name=\"twitter:card\" content=\"summary\" />";
      echo "\n  <meta name=\"twitter:site\" content=\"@RoboticsClubCFl\" />";
      echo "\n  <meta name=\"twitter:title\" content=\"" . $title . "\" />";
      echo "\n  <meta name=\"twitter:description\" content=\"" . $pageDescription . "\" />";
      echo "\n  <meta name=\"twitter:image\" content=\"";
      if (isset($markupImage)) {
        echo $markupImage;
      } else {
        echo "https://robotics.ucf.edu/assets/imgs/header/roboskull-black.png";
      }
      echo "\" />\n";
    }
    
  }

?> 
