package com.feoearth.easybook;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.google.zxing.BarcodeFormat;
import com.journeyapps.barcodescanner.BarcodeCallback;
import com.journeyapps.barcodescanner.BarcodeResult;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;
import com.journeyapps.barcodescanner.DefaultDecoderFactory;
import java.util.Collections;

/** Camera scanning is local; only a strictly validated Easybook challenge ID leaves this screen. */
public final class QrScanActivity extends Activity {
    static final String EXTRA_CHALLENGE_ID = "easybook.qr.challengeId";
    private DecoratedBarcodeView camera;
    private TextView feedback;
    private boolean complete;
    private boolean light;

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(20), dp(18), dp(20), dp(24));
        page.setBackgroundColor(Color.BLACK);
        TextView title = new TextView(this);
        title.setText("扫描登录二维码");
        title.setTextSize(27);
        title.setTextColor(Color.WHITE);
        title.setPadding(0, dp(12), 0, dp(8));
        page.addView(title);
        TextView explanation = new TextView(this);
        explanation.setText("扫描另一台设备显示的 Easybook 登录二维码，并在本机确认授权。");
        explanation.setTextColor(0xffa1a1a6);
        explanation.setTextSize(15);
        page.addView(explanation);

        camera = new DecoratedBarcodeView(this);
        camera.setStatusText("");
        camera.getBarcodeView().setDecoderFactory(new DefaultDecoderFactory(Collections.singletonList(BarcodeFormat.QR_CODE)));
        LinearLayout.LayoutParams preview = new LinearLayout.LayoutParams(-1, 0, 1);
        preview.setMargins(0, dp(20), 0, dp(12));
        page.addView(camera, preview);
        feedback = new TextView(this);
        feedback.setText("仅接受 Easybook 安全登录二维码");
        feedback.setTextColor(0xffa1a1a6);
        feedback.setGravity(Gravity.CENTER);
        feedback.setMinHeight(dp(48));
        page.addView(feedback);
        LinearLayout controls = new LinearLayout(this);
        controls.setGravity(Gravity.CENTER);
        Button cancel = new Button(this);
        cancel.setAllCaps(false);
        cancel.setText("取消");
        cancel.setOnClickListener(v -> finish());
        Button torch = new Button(this);
        torch.setAllCaps(false);
        torch.setText("打开手电筒");
        torch.setOnClickListener(v -> {
            light = !light;
            if (light) camera.setTorchOn(); else camera.setTorchOff();
            torch.setText(light ? "关闭手电筒" : "打开手电筒");
        });
        controls.addView(cancel, new LinearLayout.LayoutParams(0, dp(52), 1));
        controls.addView(torch, new LinearLayout.LayoutParams(0, dp(52), 1));
        page.addView(controls);
        setContentView(page);

        camera.decodeContinuous(new BarcodeCallback() {
            @Override public void barcodeResult(BarcodeResult result) {
                if (complete || result == null) return;
                String id = NativeAccount.qrChallengeId(result.getText());
                if (id == null) {
                    feedback.setText("不是有效的 Easybook 登录二维码，请重新对准");
                    return;
                }
                complete = true;
                camera.pause();
                setResult(RESULT_OK, new Intent().putExtra(EXTRA_CHALLENGE_ID, id));
                finish();
            }
        });
    }

    @Override protected void onResume() {
        super.onResume();
        if (!complete && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) camera.resume();
        else if (!complete) requestPermissions(new String[]{Manifest.permission.CAMERA}, 1);
    }

    @Override protected void onPause() {
        camera.pause();
        super.onPause();
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request != 1) return;
        if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) camera.resume();
        else {
            feedback.setText("相机权限未授予。请在系统设置中允许 Easybook 使用相机后重试。");
            camera.setVisibility(View.INVISIBLE);
        }
    }
}
